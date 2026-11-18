import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import app.models  # noqa: F401  (registers ORM models on the metadata)
from app.api.v1 import api_router
from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.user import User

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(application: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_local_schema()
    _seed_admin()
    yield


def _migrate_local_schema() -> None:
    """create_all() never alters existing tables. Widen conversations.title to
    TEXT (PostgreSQL only — SQLite VARCHAR has no length limit) and drop the
    legacy users.role column (RBAC removed). Idempotent."""
    try:
        with engine.begin() as connection:
            if settings.app_database_url.startswith("postgresql"):
                connection.execute(
                    text("ALTER TABLE conversations ALTER COLUMN title TYPE TEXT")
                )
                connection.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS role"))
            else:
                connection.execute(text("ALTER TABLE users DROP COLUMN role"))
    except Exception:  # noqa: BLE001
        logger.info("Skipped local schema migration (already applied or not applicable)")


def _seed_admin() -> None:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == settings.first_admin_email.lower()).first() is None:
            db.add(
                User(
                    email=settings.first_admin_email.lower(),
                    hashed_password=hash_password(settings.first_admin_password),
                    full_name="Administrator",
                )
            )
            db.commit()
            logger.info("Seeded bootstrap admin user %s", settings.first_admin_email)
    finally:
        db.close()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/api/health")
def health() -> dict:
    database = "up"
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        database = "down"

    llm = "down"
    try:
        response = httpx.get(f"{settings.ollama_base_url.rstrip('/')}/api/version", timeout=2.0)
        if response.status_code == 200:
            llm = "up"
    except Exception:  # noqa: BLE001
        pass

    return {
        "status": "ok" if database == "up" else "degraded",
        "database": database,
        "llm": llm,
        "model": settings.ollama_model,
        "version": settings.app_version,
    }
