"""Pandas-powered post-processing: JSON-safe payloads, automatic chart
recommendation and template-based insights."""

import math
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

import numpy as np
import pandas as pd


def _json_safe(value):
    if value is None:
        return None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else number
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (int, str, bool, list, dict)):
        return value
    return str(value)


def _dtype_name(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_float_dtype(series):
        return "number"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    return "string"


def dataframe_to_payload(df: pd.DataFrame, max_rows: int):
    """Convert a DataFrame into (columns, rows, truncated) JSON-safe structures."""
    truncated = len(df) > max_rows
    view = df.head(max_rows)
    columns = [{"name": str(column), "dtype": _dtype_name(view[column])} for column in view.columns]
    rows = []
    for record in view.to_dict(orient="records"):
        rows.append({str(key): _json_safe(value) for key, value in record.items()})
    return columns, rows, truncated


def is_numeric_column(series: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)


def is_temporal_column(series: pd.Series) -> bool:
    return pd.api.types.is_datetime64_any_dtype(series)


def recommend_chart(df: pd.DataFrame, suggested: Optional[str] = None) -> dict:
    """Merge the LLM's chart suggestion with data-shape heuristics."""
    if df.empty:
        return {"type": "table", "x": None, "y": [], "title": "Query result"}

    columns = list(df.columns)
    numeric = [column for column in columns if is_numeric_column(df[column])]
    temporal = [column for column in columns if is_temporal_column(df[column])]
    categorical = [column for column in columns if column not in numeric and column not in temporal]

    x = temporal[0] if temporal else (categorical[0] if categorical else None)
    y = [column for column in numeric if column != x][:3]

    chart_type = suggested if suggested in {"bar", "line", "area", "pie", "scatter", "table"} else None

    if chart_type == "pie" and (x is None or len(y) != 1 or df[x].nunique() > 8):
        chart_type = None
    if chart_type == "scatter" and (x is None or x not in numeric or not y):
        chart_type = None

    if chart_type is None:
        if x is None or not y:
            chart_type = "table"
        elif temporal and x == temporal[0]:
            chart_type = "line" if len(df) > 3 else "bar"
        elif len(numeric) >= 2 and x in numeric:
            chart_type = "scatter"
        elif len(df) <= 12 and len(y) == 1:
            chart_type = "pie" if df[x].nunique() <= 8 else "bar"
        else:
            chart_type = "bar"

    if chart_type != "table" and not y:
        chart_type = "table"

    return {"type": chart_type, "x": x, "y": y, "title": "Query result"}


def _format_number(value) -> str:
    number = float(value)
    if math.isnan(number) or math.isinf(number):
        return "n/a"
    if number == int(number):
        return f"{int(number):,}"
    return f"{number:,.2f}"


def build_insight_text(question: str, df: pd.DataFrame) -> str:
    """Template-based insight containing the actual numbers. Doubles as the
    grounding material for the LLM narrative and as the fallback when the LLM
    output is unusable."""
    if df.empty:
        return "The query returned no rows for this question."

    numeric = [column for column in df.columns if is_numeric_column(df[column])]
    temporal = [column for column in df.columns if is_temporal_column(df[column])]
    categorical = [
        column for column in df.columns if column not in numeric and column not in temporal
    ]

    if len(df) == 1:
        # Single-row (aggregate) result: state the values directly, e.g.
        # "The query returned 1 row: courses_count is 12."
        parts = []
        for column in df.columns:
            value = df.iloc[0][column]
            if column in numeric:
                if pd.notna(value):
                    parts.append(f"{column} is {_format_number(value)}")
            elif column in temporal:
                parts.append(f"{column} is {value}")
            else:
                parts.append(f"{column} is '{value}'")
        return "The query returned 1 row: " + ", ".join(parts) + "."

    parts = [f"The query returned {len(df):,} rows."]
    if numeric:
        column = numeric[0]
        series = pd.to_numeric(df[column], errors="coerce").dropna()
        if not series.empty:
            parts.append(
                f"{column} ranges from {_format_number(series.min())} to "
                f"{_format_number(series.max())} (average {_format_number(series.mean())})."
            )
    if categorical:
        column = categorical[0]
        top = df[column].astype(str).value_counts().idxmax()
        parts.append(f'The most frequent {column} is "{top}".')
    if temporal:
        column = temporal[0]
        series = df[column].dropna()
        if not series.empty:
            parts.append(f"{column} spans {series.min()} to {series.max()}.")
    return " ".join(parts)


def summary_is_grounded(summary: str, facts: str) -> bool:
    """True when the LLM summary reuses at least one number from the facts.

    Tiny models often just restate the question ("The user wants to know…")
    instead of the result; such answers are rejected in favor of the template.
    """
    fact_numbers = {
        token.replace(",", "").rstrip(".")
        for token in re.findall(r"\d[\d,\.]*", facts)
    }
    summary_numbers = {
        token.replace(",", "").rstrip(".")
        for token in re.findall(r"\d[\d,\.]*", summary)
    }
    if not fact_numbers:
        return True
    return bool(summary_numbers & fact_numbers)

