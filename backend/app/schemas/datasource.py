from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DBType = Literal["postgresql", "mysql", "mssql"]


class DataSourceTestIn(BaseModel):
    db_type: DBType
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    database: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=512)
    ssl_enabled: bool = False


class DataSourceCreate(DataSourceTestIn):
    name: str = Field(min_length=1, max_length=128)


class DataSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    db_type: DBType
    host: str
    port: int
    database: str
    username: str
    ssl_enabled: bool
    created_at: datetime


class ColumnSchemaOut(BaseModel):
    name: str
    dtype: str
    nullable: bool
    primary_key: bool


class TableSchemaOut(BaseModel):
    name: str
    columns: list[ColumnSchemaOut]


class DataSourceSchemaOut(BaseModel):
    datasource_id: int
    dialect: str
    table_count: int
    tables: list[TableSchemaOut]


class TestConnectionOut(BaseModel):
    ok: bool
    message: str
    latency_ms: Optional[int] = None
    server_version: Optional[str] = None
