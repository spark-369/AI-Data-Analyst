"""Live schema introspection for target enterprise databases, with a TTL cache
and a lightweight relevance heuristic that keeps LLM prompts small (important
for the 0.5B model)."""

import re
import time
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import inspect

from app.services.sql_engine import engine_registry


@dataclass
class ColumnInfo:
    name: str
    dtype: str
    nullable: bool
    primary_key: bool


@dataclass
class TableInfo:
    name: str
    columns: list[ColumnInfo] = field(default_factory=list)

    def render(self) -> str:
        parts = []
        for column in self.columns[:40]:
            suffix = " PK" if column.primary_key else ("" if column.nullable else " NOT NULL")
            parts.append(f"{column.name} {column.dtype}{suffix}")
        return f"{self.name}({', '.join(parts)})"


@dataclass
class DatabaseSchema:
    db_type: str
    tables: list[TableInfo] = field(default_factory=list)

    def render(self, tables: Optional[list[TableInfo]] = None) -> str:
        selected = self.tables if tables is None else tables
        return "\n".join(table.render() for table in selected)


_SCHEMA_TTL_SECONDS = 600


class SchemaCache:
    def __init__(self) -> None:
        self._cache: dict[int, tuple[float, DatabaseSchema]] = {}

    def get(self, datasource) -> DatabaseSchema:
        cached = self._cache.get(datasource.id)
        if cached is not None and time.time() - cached[0] < _SCHEMA_TTL_SECONDS:
            return cached[1]
        schema = introspect(engine_registry.get(datasource), datasource.db_type)
        self._cache[datasource.id] = (time.time(), schema)
        return schema

    def invalidate(self, datasource_id: int) -> None:
        self._cache.pop(datasource_id, None)


schema_cache = SchemaCache()


def introspect(engine, db_type: str) -> DatabaseSchema:
    inspector = inspect(engine)
    tables: list[TableInfo] = []
    for table_name in inspector.get_table_names():
        pk = set((inspector.get_pk_constraint(table_name) or {}).get("constrained_columns") or [])
        columns = [
            ColumnInfo(
                name=str(column["name"]),
                dtype=str(column.get("type")),
                nullable=bool(column.get("nullable", True)),
                primary_key=str(column["name"]) in pk,
            )
            for column in inspector.get_columns(table_name)
        ]
        tables.append(TableInfo(name=table_name, columns=columns))
    tables.sort(key=lambda table: table.name)
    return DatabaseSchema(db_type=db_type, tables=tables)


_STOPWORDS = {
    "what", "is", "the", "of", "in", "for", "to", "a", "an", "and", "or", "by", "on", "with",
    "show", "me", "list", "give", "all", "from", "where", "how", "many", "much", "are", "were",
    "do", "does", "did", "per", "each", "top", "total", "average", "avg", "sum", "count",
    "group", "order", "sort", "between", "during", "last", "month", "months", "year", "years",
    "day", "days", "week", "weeks", "please", "can", "you", "i", "want", "know", "get", "find",
    "display", "report", "data", "number", "compare", "vs", "versus", "trend", "over", "time",
    "which", "who", "whose", "that", "this", "these", "those", "there", "their", "our", "my",
    "us", "we", "it", "its", "as", "at", "be", "been", "being", "was", "has", "have", "had",
    "not", "no", "yes", "also", "only", "most", "least", "more", "less", "than", "then", "so",
    "such", "into", "about", "after", "before", "when", "while", "them", "they",
}


def select_relevant_tables(
    schema: DatabaseSchema, question: str, max_tables: int = 12
) -> list[TableInfo]:
    """Pick the tables most likely relevant to the question (cheap heuristic)."""
    lowered = question.lower()
    tokens = {
        token
        for token in re.split(r"[^a-z0-9_]+", lowered)
        if len(token) > 2 and token not in _STOPWORDS
    }
    # naive singular/plural handling
    tokens |= {token.rstrip("s") for token in list(tokens) if token.endswith("s")}

    scored: list[tuple[int, str, TableInfo]] = []
    for table in schema.tables:
        table_tokens = set(re.split(r"[^a-z0-9_]+", table.name.lower()))
        score = 0
        for token in tokens:
            if any(token == tt or token in tt for tt in table_tokens):
                score += 3
        for column in table.columns:
            column_name = column.name.lower()
            for token in tokens:
                if token == column_name or (len(token) > 3 and token in column_name):
                    score += 2
        scored.append((score, table.name, table))

    scored.sort(key=lambda item: (-item[0], item[1]))
    relevant = [table for score, _, table in scored if score > 0]
    if relevant:
        return relevant[:max_tables]
    return schema.tables[:max_tables]
