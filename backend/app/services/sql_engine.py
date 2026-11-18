"""SQLAlchemy engine management for the registered enterprise data sources."""

import time
from typing import Optional
from urllib.parse import quote_plus

from sqlalchemy import Engine, create_engine, text

from app.core.security import decrypt_secret
from app.models.datasource import DataSource

DEFAULT_PORTS = {"postgresql": 5432, "mysql": 3306, "mssql": 1433}


def build_url(
    db_type: str,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    ssl_enabled: bool = False,
) -> str:
    user = quote_plus(username)
    pwd = quote_plus(password)
    if db_type == "postgresql":
        url = f"postgresql+psycopg2://{user}:{pwd}@{host}:{port}/{database}"
        if ssl_enabled:
            url += "?sslmode=require"
        return url
    if db_type == "mysql":
        return f"mysql+pymysql://{user}:{pwd}@{host}:{port}/{database}?charset=utf8mb4"
    if db_type == "mssql":
        odbc = (
            "DRIVER={ODBC Driver 18 for SQL Server};"
            f"SERVER={host},{port};DATABASE={database};"
            f"UID={username};PWD={password};"
            "TrustServerCertificate=yes;"
        )
        return "mssql+pyodbc:///?odbc_connect=" + quote_plus(odbc)
    raise ValueError(f"Unsupported database type: {db_type}")


def _connect_args(db_type: str) -> dict:
    if db_type == "postgresql":
        return {"connect_timeout": 10, "options": "-c statement_timeout=30000"}
    if db_type == "mysql":
        return {"connect_timeout": 10}
    return {}


def build_engine(
    db_type: str,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    ssl_enabled: bool = False,
) -> Engine:
    return create_engine(
        build_url(db_type, host, port, database, username, password, ssl_enabled),
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_size=5,
        max_overflow=10,
        connect_args=_connect_args(db_type),
    )


def test_connection_params(
    db_type: str,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    ssl_enabled: bool = False,
) -> dict:
    started = time.perf_counter()
    try:
        engine = build_engine(db_type, host, port, database, username, password, ssl_enabled)
        try:
            with engine.connect() as connection:
                if db_type in ("postgresql", "mysql"):
                    version = str(connection.execute(text("SELECT version()")).scalar())
                else:
                    version = str(connection.execute(text("SELECT @@VERSION")).scalar())
        finally:
            engine.dispose()
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "ok": True,
            "message": "Connection successful",
            "latency_ms": latency,
            "server_version": version[:120],
        }
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "message": f"Connection failed: {exc}",
            "latency_ms": latency,
            "server_version": None,
        }


class EngineRegistry:
    """Caches one SQLAlchemy engine per registered data source."""

    def __init__(self) -> None:
        self._engines: dict[int, Engine] = {}

    def get(self, datasource: DataSource) -> Engine:
        engine = self._engines.get(datasource.id)
        if engine is None:
            engine = build_engine(
                datasource.db_type,
                datasource.host,
                datasource.port,
                datasource.database,
                datasource.username,
                decrypt_secret(datasource.password_encrypted),
                datasource.ssl_enabled,
            )
            self._engines[datasource.id] = engine
        return engine

    def invalidate(self, datasource_id: int) -> None:
        engine = self._engines.pop(datasource_id, None)
        if engine is not None:
            engine.dispose()


engine_registry = EngineRegistry()
