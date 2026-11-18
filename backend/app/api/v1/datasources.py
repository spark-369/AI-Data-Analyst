from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import encrypt_secret
from app.db.session import get_db
from app.models.datasource import DataSource
from app.models.user import User
from app.schemas.datasource import (
    ColumnSchemaOut,
    DataSourceCreate,
    DataSourceOut,
    DataSourceSchemaOut,
    DataSourceTestIn,
    TableSchemaOut,
    TestConnectionOut,
)
from app.services.guardrails import DIALECT_MAP
from app.services.schema_cache import DatabaseSchema, schema_cache
from app.services.sql_engine import engine_registry, test_connection_params

router = APIRouter(prefix="/datasources", tags=["datasources"])


def _get_owned_datasource(db: Session, user: User, datasource_id: int) -> DataSource:
    datasource = db.get(DataSource, datasource_id)
    if datasource is None or datasource.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")
    return datasource


def _schema_response(datasource: DataSource, schema: DatabaseSchema) -> DataSourceSchemaOut:
    return DataSourceSchemaOut(
        datasource_id=datasource.id,
        dialect=DIALECT_MAP.get(datasource.db_type, "postgres"),
        table_count=len(schema.tables),
        tables=[
            TableSchemaOut(
                name=table.name,
                columns=[
                    ColumnSchemaOut(
                        name=column.name,
                        dtype=column.dtype,
                        nullable=column.nullable,
                        primary_key=column.primary_key,
                    )
                    for column in table.columns
                ],
            )
            for table in schema.tables
        ],
    )


@router.get("", response_model=list[DataSourceOut])
def list_datasources(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(DataSource)
        .filter(DataSource.owner_id == user.id)
        .order_by(DataSource.created_at.desc())
        .all()
    )


@router.post("/test", response_model=TestConnectionOut)
def test_datasource(payload: DataSourceTestIn) -> TestConnectionOut:
    result = test_connection_params(
        payload.db_type,
        payload.host,
        payload.port,
        payload.database,
        payload.username,
        payload.password,
        payload.ssl_enabled,
    )
    return TestConnectionOut(**result)


@router.post("", response_model=DataSourceOut, status_code=status.HTTP_201_CREATED)
def create_datasource(
    payload: DataSourceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = test_connection_params(
        payload.db_type,
        payload.host,
        payload.port,
        payload.database,
        payload.username,
        payload.password,
        payload.ssl_enabled,
    )
    if not result["ok"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connection test failed: {result['message']}",
        )
    datasource = DataSource(
        name=payload.name,
        db_type=payload.db_type,
        host=payload.host,
        port=payload.port,
        database=payload.database,
        username=payload.username,
        password_encrypted=encrypt_secret(payload.password),
        ssl_enabled=payload.ssl_enabled,
        owner_id=user.id,
    )
    db.add(datasource)
    db.commit()
    db.refresh(datasource)
    return datasource


@router.get("/{datasource_id}/schema", response_model=DataSourceSchemaOut)
def get_datasource_schema(
    datasource_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataSourceSchemaOut:
    datasource = _get_owned_datasource(db, user, datasource_id)
    schema = schema_cache.get(datasource)
    return _schema_response(datasource, schema)


@router.post("/{datasource_id}/schema/refresh", response_model=DataSourceSchemaOut)
def refresh_datasource_schema(
    datasource_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DataSourceSchemaOut:
    datasource = _get_owned_datasource(db, user, datasource_id)
    schema_cache.invalidate(datasource.id)
    schema = schema_cache.get(datasource)
    return _schema_response(datasource, schema)


@router.delete("/{datasource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_datasource(
    datasource_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    datasource = _get_owned_datasource(db, user, datasource_id)
    engine_registry.invalidate(datasource.id)
    schema_cache.invalidate(datasource.id)
    db.delete(datasource)
    db.commit()
