"""Ollama LLM engine using the built-in structured-output feature.

Every call POSTs directly to Ollama's native ``/api/chat`` endpoint with the
``format`` parameter set to the JSON Schema generated from a Pydantic model.
Ollama constrains decoding with that schema (llama.cpp grammar), so the model
can only emit JSON that matches the schema — Pydantic then validates and
normalizes the parsed object (requires Ollama >= 0.5).
"""

import logging
import re
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    """Raised when the Ollama API call or the structured output fails."""


def _clean_json_text(text: str) -> str:
    """Defensive: extract a JSON object even if wrapped in prose or code fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


class LLMService:
    """Direct client for Ollama's built-in structured JSON output.

    ``format`` receives the JSON Schema of a Pydantic model, so decoding is
    constrained server-side by Ollama itself — no orchestration layer needed.
    """

    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model

    def generate(
        self,
        messages: list[dict[str, str]],
        schema: type[T],
        temperature: float | None = None,
    ) -> T:
        temp = settings.llm_temperature if temperature is None else temperature
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            # ── Built-in structured output: JSON Schema from the Pydantic model ──
            "format": schema.model_json_schema(),
            "options": {"temperature": temp, "num_ctx": settings.llm_num_ctx},
            # Keep the model warm between questions (avoids reload latency).
            "keep_alive": "30m",
        }
        try:
            with httpx.Client(timeout=httpx.Timeout(600.0, connect=10.0)) as client:
                response = client.post(f"{self.base_url}/api/chat", json=payload)
        except httpx.HTTPError as exc:
            raise LLMError(f"Could not reach Ollama at {self.base_url}: {exc}") from exc

        if response.status_code != 200:
            try:
                detail = str(response.json().get("error", ""))[:300]
            except Exception:  # noqa: BLE001
                detail = response.text[:300]
            raise LLMError(f"Ollama returned {response.status_code}: {detail}")

        data = response.json()
        content = data.get("message", {}).get("content", "")
        try:
            return schema.model_validate_json(_clean_json_text(content))
        except ValidationError as exc:
            logger.warning("Schema-invalid JSON from model: %.400s", content)
            raise LLMError(f"Model output failed schema validation: {exc}") from exc


llm_service = LLMService()
