from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    app_name: str = "Autonomous AI Data Analyst"
    app_version: str = "1.0.0"
    environment: str = "development"

    # Security
    secret_key: str = "please-change-this-secret-in-production"
    access_token_expire_minutes: int = 60 * 24  # 24h

    # Application database (chat history, users, prompt logs)
    app_database_url: str = (
        "postgresql+psycopg2://ai_analyst:ai_analyst_pass@localhost:5432/ai_analyst"
    )

    # LLM engine (Ollama)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M"
    llm_temperature: float = 0.1
    llm_num_ctx: int = 8192
    llm_max_attempts: int = 3

    # Query guardrails
    sql_row_limit: int = 1000
    chart_row_limit: int = 500
    table_preview_rows: int = 100

    # Bootstrap admin (seeded on first startup)
    first_admin_email: str = "admin@example.com"
    first_admin_password: str = "ChangeMe123!"

    # CORS (comma separated list)
    cors_origins: str = "http://localhost:3000,http://localhost"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
