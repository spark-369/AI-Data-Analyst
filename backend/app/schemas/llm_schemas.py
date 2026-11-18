from typing import Literal

from pydantic import BaseModel, Field, field_validator

ChartType = Literal["bar", "line", "area", "pie", "scatter", "table"]

_VALID_CHART_TYPES = {"bar", "line", "area", "pie", "scatter", "table"}

# Small models occasionally ignore the enum constraint (e.g. when the Ollama
# `format` grammar is unavailable) — map common synonyms instead of failing.
_CHART_SYNONYMS = {
    "barchart": "bar",
    "bar_chart": "bar",
    "bars": "bar",
    "column": "bar",
    "histogram": "bar",
    "linechart": "line",
    "line_chart": "line",
    "linegraph": "line",
    "timeseries": "line",
    "areachart": "area",
    "area_chart": "area",
    "piechart": "pie",
    "pie_chart": "pie",
    "donut": "pie",
    "doughnut": "pie",
    "scatterplot": "scatter",
    "scatter_plot": "scatter",
    "scatterchart": "scatter",
    "grid": "table",
    "none": "table",
}


class SQLGeneration(BaseModel):
    """Structured output enforced by Ollama via JSON Schema (Pydantic).

    Note: Ollama's grammar enforces JSON *types* and *enums*, but not numeric
    ranges — small models sometimes emit `confidence` on a 0-100 scale, so the
    value is normalized in a validator instead of being constrained by the
    schema.
    """

    sql: str = Field(description="A single read-only SELECT statement")
    chart_type: ChartType = Field(
        default="bar", description="Best chart type to visualize the result"
    )
    explanation: str = Field(
        default="", description="One short sentence describing what the query returns"
    )
    confidence: float = Field(
        default=0.5, description="Model confidence (0-1 or 0-100; normalized to 0-1)"
    )

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.5
        if number > 1:
            number /= 100  # model used a 0-100 scale
        return max(0.0, min(1.0, number))

    @field_validator("chart_type", mode="before")
    @classmethod
    def _normalize_chart_type(cls, value) -> str:
        if not isinstance(value, str):
            return "bar"
        normalized = value.strip().lower().replace(" ", "").replace("-", "_")
        if normalized in _VALID_CHART_TYPES:
            return normalized
        return _CHART_SYNONYMS.get(normalized, "bar")


class Insight(BaseModel):
    """Natural-language summary of the query result."""

    summary: str = Field(default="", description="Short business-friendly summary of the result")
