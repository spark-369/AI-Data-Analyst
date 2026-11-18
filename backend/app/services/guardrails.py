"""SQL guardrails powered by SQLGlot.

Every LLM-generated statement is parsed, checked against a strict read-only
policy, validated against the whitelisted table list of the target database,
and sanitized with an enforced row limit before it is ever executed.
"""

import re
from typing import Optional

import sqlglot
import sqlglot.errors
from sqlglot import exp, parse, parse_one

from app.core.config import settings

DIALECT_MAP = {"postgresql": "postgres", "mysql": "mysql", "mssql": "tsql"}

_FORBIDDEN_NODE_NAMES = [
    "Insert",
    "Delete",
    "Update",
    "Merge",
    "Create",
    "Drop",
    "Alter",
    "AlterTable",
    "TruncateTable",
    "Grant",
    "Revoke",
    "Command",
    "Use",
    "Pragma",
    "Kill",
    "Declare",
    "Cursor",
    "Analyze",
    "Attach",
    "Detach",
    "Set",
]
_FORBIDDEN_TYPES = tuple(
    node_type
    for node_type in (getattr(exp, name, None) for name in _FORBIDDEN_NODE_NAMES)
    if isinstance(node_type, type) and issubclass(node_type, exp.Expression)
)

_DANGEROUS_FUNCTIONS = {
    "pg_sleep",
    "pg_sleep_for",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "lo_import",
    "lo_export",
    "dblink",
    "dblink_exec",
    "load_file",
    "sleep",
    "benchmark",
    "xp_cmdshell",
    "sp_executesql",
    "readfile",
    "shell_exec",
    "system",
    "eval",
    "exec",
}

_DANGEROUS_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\binto\s+(out|dump)file\b",
        r"\bfor\s+update\b",
        r"\bfor\s+share\b",
        r"\bsleep\s*\(",
        r"\bbenchmark\s*\(",
        r"\bpg_sleep\b",
        r"\bxp_cmdshell\b",
        r"\bdblink\b",
        r"\blo_import\b",
        r"\blo_export\b",
        r"\bload_file\b",
    )
]

MAX_SQL_LENGTH = 10_000


def _strip_code_fences(sql: str) -> str:
    text = sql.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _limit_value(limit_node) -> Optional[int]:
    expression = limit_node.args.get("expression")
    if isinstance(expression, exp.Literal) and expression.is_int:
        try:
            return int(expression.this)
        except (TypeError, ValueError):
            return None
    return None


def _apply_row_limit(stmt, row_limit: int):
    cap = row_limit + 1  # +1 lets the pipeline detect truncation
    if isinstance(stmt, exp.Select):
        existing = stmt.args.get("limit")
        if existing is not None:
            value = _limit_value(existing)
            if value is not None and 0 < value <= row_limit:
                return stmt  # honor a small explicit LIMIT from the model
        return stmt.limit(cap)
    if hasattr(stmt, "subquery"):
        return exp.select("*").from_(stmt.subquery("_limited")).limit(cap)  # type: ignore[attr-defined]
    return None


def extract_table_names(sql: str, db_type: str) -> list[str]:
    """Best-effort extraction of the physical tables referenced by a query."""
    dialect = DIALECT_MAP.get(db_type, "postgres")
    try:
        stmt = parse_one(_strip_code_fences(sql).rstrip(";"), read=dialect)
    except Exception:  # noqa: BLE001
        return []
    cte_names = {cte.alias_or_name.lower() for cte in stmt.find_all(exp.CTE)}
    names: list[str] = []
    for table in stmt.find_all(exp.Table):
        if table.db:
            continue
        name = table.name.lower()
        if name and name not in cte_names and name not in names:
            names.append(name)
    return names



def validate_and_sanitize(
    sql: str,
    db_type: str,
    allowed_tables: set[str],
    row_limit: Optional[int] = None,
) -> tuple[bool, str, str]:
    """Validate and sanitize an LLM-generated query.

    Returns ``(ok, final_sql, message)``. On success ``final_sql`` is a single
    read-only SELECT restricted to whitelisted tables with an enforced row cap.
    """
    row_limit = row_limit or settings.sql_row_limit
    dialect = DIALECT_MAP.get(db_type, "postgres")
    cleaned = _strip_code_fences(sql).rstrip(";").strip()

    if not cleaned:
        return False, sql, "The SQL statement is empty."
    if len(cleaned) > MAX_SQL_LENGTH:
        return False, cleaned, "SQL statement is too long."

    lowered = cleaned.lower()
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(lowered):
            return False, cleaned, f"Blocked keyword pattern: {pattern.pattern}"

    try:
        statements = [
            statement for statement in parse(cleaned, read=dialect) if statement is not None
        ]
    except sqlglot.errors.ParseError as exc:
        return False, cleaned, f"SQL parse error: {exc}"
    except Exception as exc:  # noqa: BLE001
        return False, cleaned, f"SQL parse error: {exc}"

    if len(statements) != 1:
        return False, cleaned, "Exactly one SELECT statement is allowed."

    stmt = statements[0]
    while isinstance(stmt, exp.Subquery) and stmt.this is not None:
        stmt = stmt.this
    if not isinstance(stmt, (exp.Select, exp.Union)):
        return False, cleaned, "Only SELECT / WITH ... SELECT statements are allowed."

    for node in stmt.walk():
        if isinstance(node, _FORBIDDEN_TYPES):
            return False, cleaned, f"Forbidden clause detected: {type(node).__name__}"

    for fn in stmt.find_all(exp.Func):
        function_name = fn.key.lower()
        if function_name == "anonymous":
            inner = fn.args.get("this")
            function_name = str(getattr(inner, "name", inner) or "").lower()
        if function_name in _DANGEROUS_FUNCTIONS:
            return False, cleaned, f"Forbidden function: {function_name}"

    cte_names = {cte.alias_or_name.lower() for cte in stmt.find_all(exp.CTE)}
    referenced: set[str] = set()
    for table in stmt.find_all(exp.Table):
        if table.db:
            return False, cleaned, "Schema-qualified table names are not allowed."
        referenced.add(table.name.lower())

    unknown = referenced - allowed_tables - cte_names
    if unknown:
        return (
            False,
            cleaned,
            "Unknown table(s): "
            + ", ".join(sorted(unknown))
            + f". Allowed tables: {', '.join(sorted(allowed_tables))}.",
        )

    limited = _apply_row_limit(stmt, row_limit)
    if limited is None:
        return False, cleaned, "Failed to enforce the row limit on this query shape."

    final_sql = limited.sql(dialect=dialect)
    try:
        parse_one(final_sql, read=dialect)
    except Exception as exc:  # noqa: BLE001
        return False, cleaned, f"Sanitized SQL failed re-validation: {exc}"

    return True, final_sql, "ok"

