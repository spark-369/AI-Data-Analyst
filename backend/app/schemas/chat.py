from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ChartType = Literal["bar", "line", "area", "pie", "scatter", "table"]


class ChartConfig(BaseModel):
    type: ChartType = "bar"
    x: Optional[str] = None
    y: list[str] = Field(default_factory=list)
    title: str = "Query result"


class ChatAskRequest(BaseModel):
    datasource_id: int
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: Optional[int] = None


class ConversationCreate(BaseModel):
    datasource_id: int
    title: Optional[str] = Field(default=None, max_length=255)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    datasource_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class PipelineStep(BaseModel):
    step: str
    status: str  # started | done | error
    detail: str = ""
    attempt: int = 1
    latency_ms: Optional[int] = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    question: Optional[str] = None
    sql_query: Optional[str] = None
    explanation: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    chart_config: Optional[dict[str, Any]] = None
    data_json: Optional[dict[str, Any]] = None
    row_count: Optional[int] = None
    latency_ms: Optional[int] = None
    attempts: Optional[list[Any]] = None
    tables_used: Optional[list[Any]] = None
    model: Optional[str] = None
    created_at: datetime


class FinalResult(BaseModel):
    """Full result of one autonomous analysis run (final SSE event / ask response)."""

    conversation_id: int
    user_message_id: int
    assistant_message_id: Optional[int] = None
    status: str = "success"
    answer: str = ""
    explanation: Optional[str] = None
    sql: Optional[str] = None
    columns: Optional[list[dict[str, Any]]] = None
    rows: Optional[list[dict[str, Any]]] = None
    row_count: int = 0
    truncated: bool = False
    chart: Optional[ChartConfig] = None
    steps: list[PipelineStep] = Field(default_factory=list)
    latency_ms: int = 0
    error: Optional[str] = None
