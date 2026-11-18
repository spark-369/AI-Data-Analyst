"""Autonomous analysis pipeline.

question -> schema context -> SQL generation (Ollama, JSON-schema enforced)
-> SQLGlot guardrails -> read-only execution -> pandas analytics
-> chart recommendation + narrative insight, with a self-correction loop that
feeds guardrail/execution errors back to the model.
"""

import asyncio
import json
import logging
import time
from typing import Awaitable, Callable

import pandas as pd
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.conversation import Conversation, Message
from app.models.datasource import DataSource
from app.models.promptlog import PromptLog
from app.models.user import User, utcnow
from app.schemas.chat import ChartConfig, FinalResult, PipelineStep
from app.schemas.llm_schemas import Insight, SQLGeneration
from app.services import analytics, guardrails
from app.services.llm import llm_service
from app.services.schema_cache import schema_cache, select_relevant_tables
from app.services.sql_engine import engine_registry

logger = logging.getLogger(__name__)

EmitFn = Callable[[dict], Awaitable[None]]


def _sql_system_prompt(dialect: str, schema_text: str) -> str:
    return (
        f"You are an expert {dialect} data analyst. Convert the user's question "
        f"into ONE {dialect} SELECT statement.\n"
        "STRICT RULES:\n"
        "1. Respond with JSON only, with keys: sql, chart_type, explanation, confidence.\n"
        "2. Use ONLY the tables and columns listed in the schema. Never schema-qualify table names.\n"
        "3. Read-only: never use INSERT, UPDATE, DELETE, DROP, ALTER or any data-changing statement.\n"
        "4. Join tables with explicit JOIN ... ON when combining tables.\n"
        '5. For "how many", "total", "average" questions use COUNT, SUM, AVG with GROUP BY.\n'
        "6. Do not quote identifiers; use table and column names exactly as listed.\n"
        "7. Do not add LIMIT; a row limit is applied automatically.\n\n"
        f"SCHEMA:\n{schema_text}"
    )



def _build_sql_messages(
    question: str,
    schema_text: str,
    dialect: str,
    feedback: str | None,
    prev_sql: str | None,
) -> list[dict[str, str]]:
    messages = [
        {"role": "system", "content": _sql_system_prompt(dialect, schema_text)},
        {"role": "user", "content": f"Question: {question}\nRespond with the JSON object only."},
    ]
    if feedback and prev_sql:
        messages.append(
            {
                "role": "assistant",
                "content": json.dumps(
                    {
                        "sql": prev_sql,
                        "chart_type": "bar",
                        "explanation": "previous attempt",
                        "confidence": 0.5,
                    }
                ),
            }
        )
        messages.append(
            {
                "role": "user",
                "content": (
                    f"The previous SQL FAILED.\nProblem: {feedback}\n"
                    "Fix the SQL and respond again with the JSON object only."
                ),
            }
        )
    return messages



class AnalystPipeline:
    """Autonomous NL -> SQL -> analysis pipeline with a self-correction loop."""

    def __init__(
        self,
        db: Session,
        user: User,
        datasource: DataSource,
        conversation: Conversation,
    ) -> None:
        self.db = db
        self.user = user
        self.datasource = datasource
        self.conversation = conversation

    async def run(self, question: str, emit: EmitFn) -> FinalResult:
        started = time.perf_counter()
        steps: list[PipelineStep] = []

        async def step(
            name: str,
            status: str,
            detail: str = "",
            attempt: int = 1,
            latency_ms: int | None = None,
        ) -> None:
            entry = PipelineStep(
                step=name,
                status=status,
                detail=detail[:300],
                attempt=attempt,
                latency_ms=latency_ms,
            )
            steps.append(entry)
            await emit({"event": "step", "data": entry.model_dump()})

        user_message = Message(conversation_id=self.conversation.id, role="user", content=question)
        self.db.add(user_message)
        if not self.conversation.title or self.conversation.title == "New chat":
            # The conversation name is the full first prompt of that chat.
            self.conversation.title = question.strip()
        self.conversation.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(user_message)

        await step("schema", "started")
        schema = await asyncio.to_thread(schema_cache.get, self.datasource)
        relevant = select_relevant_tables(schema, question)
        schema_text = schema.render(relevant)
        await step("schema", "done", f"{len(relevant)}/{len(schema.tables)} tables in context")

        allowed_tables = {table.name.lower() for table in schema.tables}
        feedback: str | None = None
        prev_sql: str | None = None
        generation: SQLGeneration | None = None
        executed_sql: str | None = None
        tables_used: list[str] = []
        df: pd.DataFrame | None = None




        for attempt in range(1, max(1, settings.llm_max_attempts) + 1):
            await step("sql_generation", "started", attempt=attempt)
            t0 = time.perf_counter()
            messages = _build_sql_messages(question, schema_text, schema.db_type, feedback, prev_sql)
            try:
                generation = await asyncio.to_thread(
                    llm_service.generate, messages, SQLGeneration, 0.1
                )
            except Exception as exc:  # noqa: BLE001
                latency = int((time.perf_counter() - t0) * 1000)
                llm_error = f"LLM call failed: {exc}"
                self._log_prompt("sql_generation", messages, llm_error, attempt, latency, False)
                await step("sql_generation", "error", llm_error, attempt, latency)
                feedback = llm_error
                continue
            latency = int((time.perf_counter() - t0) * 1000)
            self._log_prompt(
                "sql_generation", messages, generation.model_dump_json(), attempt, latency, True
            )
            await step("sql_generation", "done", generation.sql[:280], attempt, latency)

            await step("guardrails", "started", attempt=attempt)
            ok, safe_sql, message = await asyncio.to_thread(
                guardrails.validate_and_sanitize,
                generation.sql,
                self.datasource.db_type,
                allowed_tables,
            )
            if not ok:
                await step("guardrails", "error", message, attempt)
                feedback = f"Guardrails rejected the SQL: {message}"
                prev_sql = generation.sql
                continue
            tables_used = guardrails.extract_table_names(safe_sql, self.datasource.db_type)
            await step("guardrails", "done", safe_sql[:280], attempt)

            await step("execution", "started", attempt=attempt)
            try:
                df = await asyncio.to_thread(self._execute_sql, safe_sql)
            except SQLAlchemyError as exc:
                db_error = str(getattr(exc, "orig", exc))[:500]
                await step("execution", "error", db_error, attempt)
                feedback = f"Database error: {db_error}"
                prev_sql = generation.sql
                continue
            except Exception as exc:  # noqa: BLE001
                await step("execution", "error", str(exc)[:500], attempt)
                feedback = f"Execution error: {exc}"
                prev_sql = generation.sql
                continue
            executed_sql = safe_sql
            await step(
                "execution",
                "done",
                f"{len(df)} row{'s' if len(df) != 1 else ''} returned",
                attempt,
            )
            break

        total_latency = int((time.perf_counter() - started) * 1000)



        if df is None or executed_sql is None or generation is None:
            error_message = (
                feedback
                or "The analyst could not produce a valid query. Try rephrasing the question."
            )
            assistant_message = Message(
                conversation_id=self.conversation.id,
                role="assistant",
                content=error_message,
                status="error",
                error=error_message,
                latency_ms=total_latency,
                attempts=[entry.model_dump() for entry in steps],
                model=settings.ollama_model,
                question=question,
            )
            self.db.add(assistant_message)
            self.conversation.updated_at = utcnow()
            self.db.commit()
            self.db.refresh(assistant_message)
            result = FinalResult(
                conversation_id=self.conversation.id,
                user_message_id=user_message.id,
                assistant_message_id=assistant_message.id,
                status="error",
                answer=error_message,
                error=error_message,
                steps=steps,
                latency_ms=total_latency,
            )
            await emit({"event": "final", "data": result.model_dump()})
            return result

        await step("analysis", "started")
        try:
            chart_payload = analytics.recommend_chart(
                df.head(settings.chart_row_limit), generation.chart_type
            )
            chart = ChartConfig(**chart_payload)
        except Exception:  # noqa: BLE001
            logger.exception("Chart recommendation failed; falling back to table")
            chart = ChartConfig(type="table", x=None, y=[], title="Query result")
        try:
            facts = analytics.build_insight_text(question, df)
        except Exception:  # noqa: BLE001
            logger.exception("Insight text generation failed")
            facts = f"The query returned {len(df)} row{'s' if len(df) != 1 else ''}."
        answer = facts
        t0 = time.perf_counter()
        try:
            insight_messages = self._build_insight_messages(question, facts, df)
            insight = await asyncio.to_thread(llm_service.generate, insight_messages, Insight, 0.3)
            insight_latency = int((time.perf_counter() - t0) * 1000)
            self._log_prompt(
                "insight", insight_messages, insight.model_dump_json(), 1, insight_latency, True
            )
            summary = (insight.summary or "").strip()
            # Accept the LLM narrative only when it is grounded in the actual
            # numbers for single-row (aggregate) results — tiny models love to
            # restate the question instead of the result.
            if summary and (len(df) != 1 or analytics.summary_is_grounded(summary, facts)):
                answer = summary
        except Exception as exc:  # noqa: BLE001
            self._log_prompt(
                "insight",
                [{"role": "user", "content": question}],
                f"failed: {exc}",
                1,
                int((time.perf_counter() - t0) * 1000),
                False,
            )
        await step("analysis", "done", answer[:200])



        columns, rows, truncated = analytics.dataframe_to_payload(df, settings.table_preview_rows)
        assistant_message = Message(
            conversation_id=self.conversation.id,
            role="assistant",
            content=answer,
            sql_query=executed_sql,
            explanation=generation.explanation,
            status="success",
            chart_config=chart.model_dump(),
            data_json={"columns": columns, "rows": rows, "truncated": truncated},
            row_count=int(len(df)),
            latency_ms=total_latency,
            attempts=[entry.model_dump() for entry in steps],
            tables_used=tables_used,
            model=settings.ollama_model,
            question=question,
        )
        self.db.add(assistant_message)
        self.conversation.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(assistant_message)

        result = FinalResult(
            conversation_id=self.conversation.id,
            user_message_id=user_message.id,
            assistant_message_id=assistant_message.id,
            status="success",
            answer=answer,
            explanation=generation.explanation,
            sql=executed_sql,
            columns=columns,
            rows=rows,
            row_count=int(len(df)),
            truncated=truncated,
            chart=chart,
            steps=steps,
            latency_ms=total_latency,
        )
        await emit({"event": "final", "data": result.model_dump()})
        return result

    @staticmethod
    def _dedupe_columns(df: pd.DataFrame) -> pd.DataFrame:
        """SQL can return duplicate column labels (e.g. two joined `name`
        columns). pandas 2.x keeps them as-is, and any later `df[label]` then
        returns a DataFrame instead of a Series, breaking analysis/chart code
        ("Grouper for 'name' not 1-dimensional"). Rename duplicates to
        `label`, `label_2`, `label_3`, … right after execution."""
        if df.columns.is_unique:
            return df
        counts: dict[str, int] = {}
        names: list[str] = []
        for column in df.columns:
            key = str(column)
            seen = counts.get(key, 0)
            counts[key] = seen + 1
            names.append(key if seen == 0 else f"{key}_{seen + 1}")
        df = df.copy()
        df.columns = names
        return df

    def _execute_sql(self, sql: str) -> pd.DataFrame:
        engine = engine_registry.get(self.datasource)
        with engine.connect() as connection:
            df = pd.read_sql_query(sql, connection)
        return self._dedupe_columns(df)

    def _build_insight_messages(
        self, question: str, facts: str, df: pd.DataFrame
    ) -> list[dict[str, str]]:
        sample = df.head(5)
        preview = json.dumps(
            [dict(record) for record in sample.to_dict(orient="records")], default=str
        )[:1500]
        return [
            {
                "role": "system",
                "content": (
                    "You write short business insights about query results.\n"
                    "RULES:\n"
                    "1. State the key numbers from the FACTS. Never invent numbers.\n"
                    "2. Do not restate the question and do not mention 'the user'.\n"
                    '3. At most 2 short sentences. Respond with JSON only: {"summary": "..."}\n'
                    "Example:\n"
                    "Question: How many courses are available?\n"
                    "FACTS: The query returned 1 row: courses_count is 42.\n"
                    'Good summary: "There are 42 courses available."'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Question: {question}\nFACTS: {facts}\nSample rows: {preview}\n"
                    "Write the insight summary now."
                ),
            },
        ]

    def _log_prompt(
        self,
        step_name: str,
        messages: list[dict[str, str]],
        response: str,
        attempt: int,
        latency_ms: int,
        success: bool,
    ) -> None:
        try:
            self.db.add(
                PromptLog(
                    user_id=self.user.id,
                    conversation_id=self.conversation.id,
                    datasource_id=self.datasource.id,
                    step=step_name,
                    prompt=json.dumps(messages, default=str)[:6000],
                    response=str(response)[:6000],
                    model=settings.ollama_model,
                    attempt=attempt,
                    latency_ms=latency_ms,
                    success=success,
                )
            )
            self.db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to write prompt log")
            self.db.rollback()


