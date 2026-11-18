from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.conversation import Conversation, Message
from app.models.datasource import DataSource
from app.models.promptlog import PromptLog
from app.models.user import User
from app.schemas.analytics import OverviewStats, PromptLogOut, RecentChartItem

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _assistant_messages(db: Session, user: User):
    return (
        db.query(Message)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(Conversation.user_id == user.id, Message.role == "assistant")
    )


@router.get("/overview", response_model=OverviewStats)
def overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> OverviewStats:
    base = _assistant_messages(db, user)
    total = base.count()
    successful = base.filter(Message.status == "success").count()
    avg_latency = (
        base.filter(Message.status == "success")
        .with_entities(func.avg(Message.latency_ms))
        .scalar()
    )
    total_conversations = db.query(Conversation).filter(Conversation.user_id == user.id).count()
    total_datasources = db.query(DataSource).filter(DataSource.owner_id == user.id).count()

    counter: Counter = Counter()
    recent = (
        base.filter(Message.status == "success")
        .order_by(Message.created_at.desc())
        .limit(300)
        .all()
    )
    for message in recent:
        for table in message.tables_used or []:
            counter[str(table)] += 1

    return OverviewStats(
        total_questions=total,
        successful=successful,
        failed=max(0, total - successful),
        success_rate=round(successful / total * 100, 1) if total else 0.0,
        avg_latency_ms=round(float(avg_latency or 0), 1),
        total_conversations=total_conversations,
        total_datasources=total_datasources,
        top_tables=[{"table": name, "count": count} for name, count in counter.most_common(8)],
    )


@router.get("/recent-charts", response_model=list[RecentChartItem])
def recent_charts(
    limit: int = 8,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(Message, DataSource.name)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .outerjoin(DataSource, Conversation.datasource_id == DataSource.id)
        .filter(
            Conversation.user_id == user.id,
            Message.role == "assistant",
            Message.status == "success",
            Message.chart_config.isnot(None),
        )
        .order_by(Message.created_at.desc())
        .limit(max(1, min(limit, 24)))
        .all()
    )
    return [
        RecentChartItem(
            message_id=message.id,
            conversation_id=message.conversation_id,
            datasource_name=datasource_name,
            question=message.question or "",
            chart=message.chart_config or {},
            rows=(message.data_json or {}).get("rows", []),
            created_at=message.created_at,

        )
        for message, datasource_name in rows
    ]


@router.get("/prompt-logs", response_model=list[PromptLogOut])
def prompt_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(PromptLog)
        .filter(PromptLog.user_id == user.id)
        .order_by(PromptLog.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
