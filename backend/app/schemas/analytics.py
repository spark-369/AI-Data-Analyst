from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class OverviewStats(BaseModel):
    total_questions: int = 0
    successful: int = 0
    failed: int = 0
    success_rate: float = 0.0
    avg_latency_ms: float = 0.0
    total_conversations: int = 0
    total_datasources: int = 0
    top_tables: list[dict[str, Any]] = Field(default_factory=list)


class RecentChartItem(BaseModel):
    message_id: int
    conversation_id: int
    datasource_name: Optional[str] = None
    question: str = ""
    chart: dict[str, Any]
    rows: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime



class PromptLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    step: str
    prompt: str
    response: str
    model: str
    attempt: int
    latency_ms: Optional[int] = None
    success: bool
    conversation_id: Optional[int] = None
    datasource_id: Optional[int] = None
    created_at: datetime
