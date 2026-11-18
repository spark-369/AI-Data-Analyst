import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.conversation import Conversation, Message
from app.models.datasource import DataSource
from app.models.user import User
from app.schemas.chat import (
    ChatAskRequest,
    ConversationCreate,
    ConversationOut,
    FinalResult,
    MessageOut,
)
from app.services.analyst import AnalystPipeline

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


def _get_datasource(db: Session, user: User, datasource_id: int) -> DataSource:
    datasource = db.get(DataSource, datasource_id)
    if datasource is None or datasource.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")
    return datasource


def _get_owned_conversation(db: Session, user: User, conversation_id: int) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


def _get_or_create_conversation(db: Session, user: User, payload: ChatAskRequest) -> Conversation:
    if payload.conversation_id:
        return _get_owned_conversation(db, user, payload.conversation_id)
    # Name the conversation after the first prompt right away — this way even a
    # cancelled stream can never leave a "New chat" entry in the list.
    conversation = Conversation(
        user_id=user.id,
        datasource_id=payload.datasource_id,
        title=payload.question.strip(),
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def _cleanup_new_chat_conversations(db: Session, user: User) -> None:
    """Self-heal historical leftovers so the list never shows "New chat":
    conversations still carrying the placeholder get renamed to their first
    user message; empty ones (streams cancelled before the analyst ran) are
    removed."""
    stale = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id, Conversation.title == "New chat")
        .all()
    )
    if not stale:
        return
    for conversation in stale:
        first_message = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation.id,
                Message.role == "user",
            )
            .order_by(Message.created_at.asc())
            .first()
        )
        if first_message is not None and first_message.content.strip():
            conversation.title = first_message.content.strip()
        else:
            db.delete(conversation)
    db.commit()


@router.post("/ask", response_model=FinalResult)
async def ask_question(
    payload: ChatAskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FinalResult:
    datasource = _get_datasource(db, user, payload.datasource_id)
    conversation = _get_or_create_conversation(db, user, payload)
    pipeline = AnalystPipeline(db=db, user=user, datasource=datasource, conversation=conversation)

    async def collect(event: dict) -> None:
        return None

    try:
        return await pipeline.run(payload.question, collect)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Analysis pipeline failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc


@router.post("/stream")
async def stream_chat(
    payload: ChatAskRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    datasource = _get_datasource(db, user, payload.datasource_id)
    conversation = _get_or_create_conversation(db, user, payload)
    pipeline = AnalystPipeline(db=db, user=user, datasource=datasource, conversation=conversation)

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def runner() -> None:
            try:
                await pipeline.run(payload.question, emit=queue.put)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Analysis pipeline crashed")
                await queue.put({"event": "error", "data": {"message": str(exc)}})
            finally:
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event, default=str)}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    datasource_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _cleanup_new_chat_conversations(db, user)
    query = db.query(Conversation).filter(Conversation.user_id == user.id)
    if datasource_id is not None:
        query = query.filter(Conversation.datasource_id == datasource_id)
    return query.order_by(Conversation.updated_at.desc()).limit(100).all()


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_datasource(db, user, payload.datasource_id)
    conversation = Conversation(
        user_id=user.id,
        datasource_id=payload.datasource_id,
        title=payload.title or "New chat",
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def get_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conversation = _get_owned_conversation(db, user, conversation_id)
    return conversation.messages


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    conversation = _get_owned_conversation(db, user, conversation_id)
    db.delete(conversation)
    db.commit()
