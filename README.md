# AI Data Analyst — Autonomous NL → SQL BI Dashboard

An autonomous, full-stack **AI Data Analyst**: users connect their own enterprise databases, ask business questions in plain English, and receive the SQL, the data, a chart, and a grounded narrative insight — streamed live step-by-step.

> **Stack at a glance** — Backend: Python · FastAPI · SQLAlchemy 2 · PostgreSQL · Ollama (structured JSON output) · SQLGlot guardrails · pandas. Frontend: Next.js (App Router) · React 19 · Tailwind CSS 4 · Recharts · Radix UI.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Repository Structure](#repository-structure)
5. [Getting Started](#getting-started)
6. [Environment Variables](#environment-variables)
7. [Backend Documentation](#backend-documentation)
8. [Frontend Documentation](#frontend-documentation)
9. [End-to-End Data Flow](#end-to-end-data-flow)
10. [Security Model](#security-model)
11. [Operational Notes & Limitations](#operational-notes--limitations)

## Overview

The application is a **self-hosted ChatBI (chat business intelligence) platform**. It never ships data to a third-party LLM — instead it drives a **local Ollama model** through a deterministic, multi-stage pipeline:

| Capability | Description |
|---|---|
| **Multi-database connectivity** | Register PostgreSQL, MySQL, or SQL Server sources (host/port/db/user/password/SSL). Credentials are encrypted at rest with Fernet. |
| **Autonomous analysis pipeline** | `question → schema context → LLM SQL generation → SQL guardrails → read-only execution → pandas analytics → chart + narrative insight`, with a **self-correction loop** that feeds guardrail/execution errors back to the model (up to 3 attempts). |
| **Live streaming UI** | Server-Sent Events (SSE) stream every pipeline step to the chat in real time; the stream is abortable mid-run. |
| **Hard SQL guardrails** | SQLGlot-parsed, single read-only `SELECT` only; whitelisted tables; dangerous functions/keywords blocked; enforced row cap. |
| **Automatic visualization** | LLM chart suggestion merged with data-shape heuristics (temporal/numeric/categorical detection) → bar, line, area, pie, scatter, or table. |
| **Grounded insights** | The narrative summary is accepted only when it reuses real numbers from the result (anti-hallucination check); otherwise a template-based fallback is used. |
| **Full audit trail** | Every LLM prompt/response (per step, per attempt, with latency) is persisted in `prompt_logs`; every answer keeps its SQL, trace, row count, and latency on the message. |
| **Usage analytics** | A dashboard with success rate, average end-to-end latency, most-used tables, and a gallery of recent charts. |

## Architecture

```
┌────────────────────────────┐        HTTP/JSON + SSE          ┌──────────────────────────────┐
│  Frontend (Next.js 16)     │ ◄─────────────────────────────► │  Backend (FastAPI)           │
│  http://localhost:3000     │   Bearer JWT on every request   │  http://localhost:8000       │
│                            │                                 │                              │
│  Landing / Auth pages      │   POST /api/v1/auth/*           │  ┌────────────────────────┐  │
│  Dashboard (stats+charts)  │   POST /api/v1/chat/stream ──── │  │ AnalystPipeline        │  │
│  Chat (streaming analyst)  │        (SSE: step | final)      │  │  schema → SQL → guard  │  │
│  Data Sources (CRUD)       │   /api/v1/datasources/*         │  │  → execute → analyze   │  │
└────────────────────────────┘   /api/v1/analytics/*           │  └───────┬────────────────┘  │
                                                               │          │                   │
                             ┌─────────────────────────────────┼──────────┼────────────────┐
                             │                                 │          ▼                │
                     ┌───────┴───────┐                 ┌──────┴─────────────┐      ┌─────┴──────┐
                     │ App database  │                 │ Target enterprise  │      │   Ollama   │
                     │ PostgreSQL    │                 │ databases          │      │ (local LLM)│
                     │ users, data_  │                 │ PostgreSQL / MySQL │      │ /api/chat  │
                     │ sources,      │                 │ / SQL Server       │      │ structured │
                     │ conversations,│                 │ (read-only via     │      │ JSON output│
                     │ messages,     │                 │  SQLAlchemy        │      └────────────┘
                     │ prompt_logs   │                 │  engine registry)  │
                     └───────────────┘                 └────────────────────┘
```

**Key architectural decisions**

- **Two database roles.** The *app database* stores users, data-source registrations, conversations, messages, and prompt logs. The *target databases* are user-registered enterprise sources that the analyst queries read-only through dedicated SQLAlchemy engines.
- **Structured LLM output.** The backend POSTs to Ollama's native `/api/chat` with `format` set to the JSON Schema of a Pydantic model, so decoding is grammar-constrained server-side (requires Ollama ≥ 0.5); Pydantic then validates and normalizes the result.
- **Defense in depth on generated SQL.** Prompt rules → SQLGlot AST validation → table whitelist → dangerous-function/keyword blacklist → enforced `LIMIT` → re-parse of the sanitized SQL before execution.
- **Streaming-first chat.** `/chat/stream` runs the pipeline in a background asyncio task and forwards events through an `asyncio.Queue` as SSE frames; the client can abort and the database is never left with a placeholder conversation.

## Tech Stack

### Backend (`backend/`)

| Component | Technology | Version |
|---|---|---|
| Web framework | FastAPI | 0.115.6 |
| ASGI server | Uvicorn (`[standard]` extras) | 0.32.1 |
| Validation / settings | Pydantic · pydantic-settings | 2.10.4 · 2.7.1 |
| ORM / app database | SQLAlchemy 2 (declarative, `Mapped` columns) | 2.0.36 |
| App DB drivers | psycopg2-binary (PostgreSQL, default) · pymysql (MySQL) | 2.9.10 · 1.1.1 |
| Target DB drivers | psycopg2 · pymysql · pyodbc *(optional, for MSSQL)* | — |
| Data processing | pandas | 2.2.3 |
| SQL parsing / guardrails | SQLGlot | 25.24.5 |
| LLM transport | httpx → Ollama `/api/chat` (structured output) | 0.28.1 |
| Auth | python-jose (HS256 JWT) · passlib + bcrypt | 3.3.0 · 1.7.4 + bcrypt 4.0.1 |
| Credential encryption | cryptography (Fernet) | 44.0.0 |
| Multipart parsing | python-multipart | 0.0.20 |

### Frontend (`frontend/`)

| Component | Technology | Version |
|---|---|---|
| Framework | Next.js App Router (Turbopack, `cacheComponents`, React Compiler) | 16.4.6 |
| UI runtime | React / React DOM | 19.3.0 |
| Styling | Tailwind CSS 4 via `@tailwindcss/turbopack`, CSS-variable design tokens | 4.3.3 |
| UI primitives | Radix UI (dialog, select, tabs, label, slot) | latest |
| Charts | Recharts | 2.15.4 |
| Notifications | Sonner (toaster) | 2.0.7 |
| Icons | lucide-react | 0.525.0 |
| Utilities | clsx · tailwind-merge · class-variance-authority | latest |

## Repository Structure

```
v1/
├── README.md                      ← this document
├── backend/
│   ├── requirements.txt           ← pinned Python dependencies
│   └── app/
│       ├── main.py                ← FastAPI app: lifespan (migrate + seed admin), CORS, /api/health
│       ├── api/
│       │   ├── deps.py            ← get_current_user (OAuth2 Bearer → JWT → User)
│       │   └── v1/
│       │       ├── __init__.py    ← api_router (mounted at /api/v1)
│       │       ├── auth.py        ← register / login / me
│       │       ├── datasources.py ← CRUD + connection test + schema introspection
│       │       ├── chat.py        ← ask (JSON), stream (SSE), conversations & messages
│       │       └── analytics.py   ← overview stats, recent charts, prompt logs
│       ├── core/
│       │   ├── config.py          ← pydantic-settings (env-driven configuration)
│       │   └── security.py        ← bcrypt hashing, JWT, Fernet secret encryption
│       ├── db/
│       │   ├── base.py            ← DeclarativeBase
│       │   └── session.py         ← engine + SessionLocal + get_db dependency
│       ├── models/                ← User, DataSource, Conversation, Message, PromptLog
│       ├── schemas/               ← Pydantic v2 DTOs (auth, datasource, chat, analytics, llm_schemas)
│       └── services/
│           ├── analyst.py         ← AnalystPipeline (autonomous run + SSE emit + self-correction)
│           ├── llm.py             ← Ollama structured-output client (LLMService)
│           ├── guardrails.py      ← SQLGlot validation & sanitization
│           ├── schema_cache.py    ← live schema introspection + TTL cache + relevance heuristic
│           ├── sql_engine.py      ← per-source engine registry + connection test
│           └── analytics.py       ← pandas post-processing, chart recommendation, insight text
└── frontend/
    ├── package.json               ← scripts: dev / build / start
    ├── next.config.mjs            ← cacheComponents, reactCompiler, Turbopack Tailwind
    ├── jsconfig.json              ← "@/*" → "./src/*"
    └── src/
        ├── app/
        │   ├── layout.js          ← root layout: Geist fonts, ThemeProvider, AuthProvider, Toaster
        │   ├── globals.css        ← Tailwind 4 + design tokens (light/dark)
        │   ├── page.js            ← landing page
        │   ├── login/page.js      ← sign in
        │   ├── register/page.js   ← sign up
        │   ├── error.js / not-found.js
        │   └── (dashboard)/       ← route group with sidebar + auth gate
        │       ├── layout.js
        │       ├── dashboard/page.js   ← usage overview
        │       ├── chat/page.js        ← the analyst chat (SSE)
        │       └── datasources/page.js ← data-source management
        ├── components/
        │   ├── auth-provider.js   ← AuthContext (login/register/logout/bootstrap)
        │   ├── theme-provider.js  ← light/dark/system theme + toggle
        │   ├── user-menu.js · brand.js · page-header.js · empty-state.js
        │   ├── data-table.js      ← full result table
        │   ├── charts/chart-renderer.js ← Recharts renderer (bar/line/area/pie/scatter/table)
        │   ├── chat/message-item.js     ← message card + pipeline trace rows
        │   └── ui/                ← avatar, badge, button, card, dialog, input, label,
        │                            select, skeleton, table, tabs, textarea
        └── lib/
            ├── api.js             ← fetch wrapper, token storage, SSE reader (streamAsk)
            └── utils.js           ← cn(), initials(), timeAgo()
```

## Getting Started

### Prerequisites

- **Python 3.11+**
- **Node.js 18.18+** (Node 20+ recommended for Next.js 16)
- **PostgreSQL** running locally (default app-database target; any SQLAlchemy-compatible URL works)
- **Ollama ≥ 0.5** with the default model pulled:

```bash
ollama pull hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M
```

> For SQL Server data sources additionally install `pyodbc` and the **Microsoft ODBC Driver 18 for SQL Server**.

### 1. Backend (port 8000)

```bash
cd backend

# (optional but recommended) virtual environment
python -m venv .venv && source .venv/bin/activate

pip install -r requirements.txt

# configure — see the Environment Variables section below, then create backend/.env

uvicorn app.main:app --reload
```

On startup the app:

1. Runs `Base.metadata.create_all()` (creates `users`, `data_sources`, `conversations`, `messages`, `prompt_logs`);
2. Applies a small idempotent schema migration (widens `conversations.title` to `TEXT` on PostgreSQL, drops the legacy `users.role` column);
3. Seeds the **bootstrap admin** from `FIRST_ADMIN_EMAIL` / `FIRST_ADMIN_PASSWORD` (defaults `admin@example.com` / `ChangeMe123!`).

Interactive API docs: **Swagger UI** at `http://localhost:8000/api/docs`, **ReDoc** at `/api/redoc`, OpenAPI schema at `/api/openapi.json`. Health probe at `GET /api/health`.

### 2. Frontend (port 3000)

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

No `.env` is required for local development — the client defaults to `http://localhost:8000/api`. Override with `NEXT_PUBLIC_API_URL` if the backend runs elsewhere (build-time constant).

### 3. First run

1. Open `http://localhost:3000` → **Register** (or sign in with the seeded admin).
2. Go to **Data Sources → Add data source**, fill in the connection form, use **Test connection** (returns latency + server version), then **Save**.
3. Open **Chat**, pick the data source, ask a question (e.g. *"Total revenue by month"*), and watch the live pipeline trace; results arrive with **Chart / Data / SQL / Trace** tabs.

## Environment Variables

### Backend — `backend/.env` (all optional; defaults shown)

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `Autonomous AI Data Analyst` | Title in the OpenAPI docs |
| `APP_VERSION` | `1.0.0` | Reported by `/api/health` |
| `ENVIRONMENT` | `development` | Free-form environment tag |
| `SECRET_KEY` | `please-change-this-secret-in-production` | Signs JWTs **and** derives the Fernet key that encrypts stored data-source passwords. **Must be changed in production** (rotating it invalidates tokens and stored credentials). |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24 h) | JWT lifetime |
| `APP_DATABASE_URL` | `postgresql+psycopg2://ai_analyst:ai_analyst_pass@localhost:5432/ai_analyst` | App database (SQLAlchemy URL) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server base URL |
| `OLLAMA_MODEL` | `hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M` | Chat model tag |
| `LLM_TEMPERATURE` | `0.1` | Default sampling temperature (SQL generation) |
| `LLM_NUM_CTX` | `8192` | Ollama context window |
| `LLM_MAX_ATTEMPTS` | `3` | Max SQL generation → guardrail → execution retries |
| `SQL_ROW_LIMIT` | `1000` | Hard row cap enforced on generated SQL (+1 sentinel to detect truncation) |
| `CHART_ROW_LIMIT` | `500` | Rows fed to chart recommendation |
| `TABLE_PREVIEW_ROWS` | `100` | Rows stored/returned in the result preview |
| `FIRST_ADMIN_EMAIL` | `admin@example.com` | Bootstrap admin seeded on first start |
| `FIRST_ADMIN_PASSWORD` | `ChangeMe123!` | Bootstrap admin password |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost` | Comma-separated allow-list |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api` | Backend base URL (build-time) |

### Browser storage keys

| Key | Purpose |
|---|---|
| `aida_token` | JWT access token |
| `aida_theme` | Theme preference (`light` / `dark` / `system`) |

## Backend Documentation

### Application bootstrap (`app/main.py`)

- FastAPI app titled `settings.app_name`, version `settings.app_version`.
- Docs exposed at `/api/docs` (Swagger), `/api/redoc`, `/api/openapi.json`.
- **CORS middleware** with origins from `CORS_ORIGINS`, credentials enabled.
- Router mounted at prefix **`/api/v1`**.
- **Lifespan** (runs once at startup): `create_all()` → `_migrate_local_schema()` → `_seed_admin()`.
- **`GET /api/health`** (public): pings the app database (`SELECT 1`) and Ollama (`GET {OLLAMA_BASE_URL}/api/version`) and returns:

```json
{ "status": "ok", "database": "up", "llm": "up", "model": "hf.co/Qwen/...", "version": "1.0.0" }
```

`status` is `"ok"` when the database is up, `"degraded"` otherwise; `llm` is informational.

### Data model (SQLAlchemy 2, `app/models/`)

```
users 1 ──── n data_sources        (data_sources.owner_id → users.id, ON DELETE SET NULL)
users 1 ──── n conversations       (conversations.user_id → users.id, ON DELETE SET NULL)
data_sources 1 ── n conversations  (conversations.datasource_id → data_sources.id, ON DELETE SET NULL)
conversations 1 ── n messages      (messages.conversation_id → conversations.id, ON DELETE CASCADE)
prompt_logs (nullable FKs → users, conversations, data_sources; ON DELETE SET NULL)
```

| Table | Columns (notable) |
|---|---|
| `users` | `id`, `email` (unique, indexed), `hashed_password` (bcrypt), `full_name`, `is_active`, `created_at` |
| `data_sources` | `id`, `name`, `db_type` (`postgresql` \| `mysql` \| `mssql`), `host`, `port`, `database`, `username`, `password_encrypted` (Fernet), `ssl_enabled`, `owner_id`, `created_at` — unique (`owner_id`, `name`) |
| `conversations` | `id`, `user_id`, `datasource_id`, `title` (defaults `"New chat"`, renamed to the first user prompt), `created_at`, `updated_at` |
| `messages` | `id`, `conversation_id`, `role` (`user` \| `assistant`), `content`, plus assistant analytics payload: `question`, `sql_query`, `explanation`, `status` (`success` \| `error`), `error`, `chart_config` (JSON), `data_json` (JSON: columns/rows/truncated), `row_count`, `latency_ms`, `attempts` (JSON pipeline trace), `tables_used` (JSON), `model`, `created_at` |
| `prompt_logs` | `id`, `user_id`, `conversation_id`, `datasource_id`, `step` (`sql_generation` \| `insight`), `prompt`, `response`, `model`, `attempt`, `latency_ms`, `success`, `created_at` |

All timestamps are timezone-aware UTC (`datetime.now(timezone.utc)`).

### Security (`app/core/security.py`, `app/api/deps.py`)

- **Passwords** — bcrypt via `passlib.context.CryptContext` (`hash_password` / `verify_password`).
- **Sessions** — HS256 JWT (python-jose), subject = user email, expiry `ACCESS_TOKEN_EXPIRE_MINUTES`. Clients send `Authorization: Bearer <token>`; `get_current_user` resolves the token to a `User` (401 on missing/invalid token or unknown/inactive user).
- **Credentials at rest** — data-source passwords are encrypted with **Fernet** using a key derived deterministically from `SECRET_KEY` (SHA-256 → url-safe base64). They are decrypted only in-memory when building the target engine.
- **CORS** — allow-list from `CORS_ORIGINS`, `allow_credentials=True`.

### API Reference

All routes are prefixed with `/api/v1`. Unless marked **public**, the `Authorization: Bearer <JWT>` header is required and results are scoped to the calling user.

#### Auth — `app/api/v1/auth.py`

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| `POST` | `/auth/register` | `{ email, password (≥8 chars), full_name? }` | `201` `UserOut` | `409` if the email exists |
| `POST` | `/auth/login` | `{ email, password }` | `Token { access_token, token_type: "bearer" }` | `401` on bad credentials, `403` if disabled |
| `GET` | `/auth/me` | — | `UserOut` | Current user |

#### Data Sources — `app/api/v1/datasources.py`

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| `GET` | `/datasources` | — | `DataSourceOut[]` | Newest first, owner-scoped |
| `POST` | `/datasources/test` | `{ db_type, host, port, database, username, password, ssl_enabled }` | `TestConnectionOut { ok, message, latency_ms, server_version }` | **Public** (nothing is stored) |
| `POST` | `/datasources` | `DataSourceTestIn + name` | `201` `DataSourceOut` | Connection is tested first; `400` if it fails. Password stored Fernet-encrypted |
| `GET` | `/datasources/{id}/schema` | — | `DataSourceSchemaOut` | Tables + columns (name/dtype/nullable/primary key); served from the TTL cache |
| `POST` | `/datasources/{id}/schema/refresh` | — | `DataSourceSchemaOut` | Invalidates the cache and re-introspects |
| `DELETE` | `/datasources/{id}` | — | `204` | Disposes the cached engine + schema cache; conversations are kept |

Ownership violations return `404` (not `403`) to avoid leaking resource existence.

#### Chat — `app/api/v1/chat.py`

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| `POST` | `/chat/ask` | `{ datasource_id, question (1–2000 chars), conversation_id? }` | `FinalResult` | Non-streaming variant; runs the same pipeline and returns the final payload |
| `POST` | `/chat/stream` | same as above | **SSE** stream (`text/event-stream`) | Frames: `data: {"event": "step"|"final"|"error", "data": {...}}\n\n` |
| `GET` | `/chat/conversations` | `datasource_id?` | `ConversationOut[]` | Self-heals stale `"New chat"` rows; newest first, limit 100 |
| `POST` | `/chat/conversations` | `{ datasource_id, title? }` | `201` `ConversationOut` | Explicit empty conversation |
| `GET` | `/chat/conversations/{id}/messages` | — | `MessageOut[]` | Ordered by creation |
| `DELETE` | `/chat/conversations/{id}` | — | `204` | Cascade-deletes messages |

SSE semantics: the pipeline runs in a background task; every progress update is pushed through an `asyncio.Queue` and serialized as an SSE frame. When the runner finishes, a sentinel closes the stream; on crash an `error` event is emitted first. The client may abort at any time (`task.cancel()` in the generator's `finally`).

#### Analytics — `app/api/v1/analytics.py`

| Method | Path | Query | Response | Notes |
|---|---|---|---|---|
| `GET` | `/analytics/overview` | — | `OverviewStats` | Questions asked, successful/failed, success rate, avg latency, conversation & data-source counts, top-8 queried tables (from the last 300 successful answers) |
| `GET` | `/analytics/recent-charts` | `limit` (default 8, max 24) | `RecentChartItem[]` | Latest successful assistant messages that carry a chart, with rows for re-rendering |
| `GET` | `/analytics/prompt-logs` | `limit` (default 50, max 200) | `PromptLogOut[]` | Audit trail of LLM prompts/responses |

#### Health — `app/main.py`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | public | Database + Ollama reachability probe |

### The Autonomous Analysis Pipeline (`app/services/analyst.py`)

`AnalystPipeline.run(question, emit)` executes the following stages, emitting a `step` SSE event for each stage transition (started / done / error, with attempt number and latency):

```
1. Persist user message        → Message(role="user"); conversation title = first prompt
2. schema        (step)        → cached introspection; relevance heuristic selects ≤12 tables
3. sql_generation (step, ×N)   → Ollama structured output (SQLGeneration: sql, chart_type,
                                 explanation, confidence 0–1) at temperature 0.1
4. guardrails    (step, ×N)    → SQLGlot validate_and_sanitize → safe SQL + table list
5. execution     (step, ×N)    → pandas read_sql_query on the target engine (dedupe columns)
   ↺ self-correction loop      → on LLM failure, guardrail rejection, or DB error the message is
                                 fed back as chat feedback and the loop retries (≤ LLM_MAX_ATTEMPTS)
6. analysis      (step)        → chart recommendation (heuristic ∪ LLM suggestion, ≤ CHART_ROW_LIMIT
                                 rows) + template "facts" + LLM Insight summary (temperature 0.3)
                                 accepted only if grounded in real numbers for single-row results
7. Persist assistant message   → content, sql, chart, rows (≤ TABLE_PREVIEW_ROWS), latency, trace
8. Emit final                  → FinalResult JSON
```

If every attempt fails, the pipeline stores an assistant message with `status="error"` (including the last feedback text and the full step trace) and emits a `final` event with `status="error"`.

**Prompting.** The SQL system prompt fixes the dialect (PostgreSQL / MySQL / T-SQL), injects the relevant schema, and enforces strict rules: JSON-only reply, only listed tables, no schema-qualified names, read-only, explicit `JOIN … ON`, aggregate + `GROUP BY` for totals, no identifier quoting, no `LIMIT` (applied automatically). The insight prompt demands ≤ 2 short sentences using only numbers from the facts.

### SSE Event Contract (`POST /api/v1/chat/stream`)

Each frame is `data: {json}\n\n` with one of:

| Event | Payload |
|---|---|
| `step` | `PipelineStep { step: "schema"|"sql_generation"|"guardrails"|"execution"|"analysis", status: "started"|"done"|"error", detail, attempt, latency_ms }` |
| `final` | `FinalResult { conversation_id, user_message_id, assistant_message_id, status, answer, explanation, sql, columns[], rows[], row_count, truncated, chart { type, x, y[], title }, steps[], latency_ms, error }` |
| `error` | `{ message }` — emitted only when the pipeline itself crashes |

Response headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `Connection: keep-alive`.

### Services

#### `llm.py` — Ollama structured output

- Single client for `POST {OLLAMA_BASE_URL}/api/chat` with `stream: false`, `format: <JSON Schema from the Pydantic model>`, `options: { temperature, num_ctx }`, `keep_alive: "30m"` (keeps the model warm), timeout 600 s (10 s connect).
- Response content is defensively unwrapped (code fences / prose stripped) then validated against the schema (`SQLGeneration`, `Insight`); failures raise `LLMError`.
- `SQLGeneration` normalization: `confidence` clamped to 0–1 (0–100 scales divided by 100); `chart_type` synonyms mapped (`histogram → bar`, `donut → pie`, `grid/none → table`, …) because small models occasionally ignore enum constraints.
- Every call is logged to `prompt_logs` (prompt, response, model, attempt, latency, success).

#### `guardrails.py` — SQLGlot validation & sanitization

`validate_and_sanitize(sql, db_type, allowed_tables) -> (ok, final_sql, message)`:

1. Strip code fences, reject empty statements and statements > 10 000 chars.
2. Blacklist dangerous regex patterns (`INTO OUTFILE/DUMPFILE`, `FOR UPDATE/SHARE`, `sleep(`, `benchmark(`, `pg_sleep`, `xp_cmdshell`, `dblink`, `lo_import/export`, `load_file`, …).
3. Parse with the dialect-specific SQLGlot parser; **exactly one statement** allowed, and it must be `SELECT` / `WITH … SELECT` / a `UNION` of selects (subqueries unwrapped).
4. Reject any forbidden AST node: `Insert, Delete, Update, Merge, Create, Drop, Alter, TruncateTable, Grant, Revoke, Command, Use, Pragma, Kill, Declare, Cursor, Analyze, Attach, Detach, Set`.
5. Reject dangerous functions (`pg_sleep`, `pg_read_file`, `dblink*`, `load_file`, `xp_cmdshell`, `sp_executesql`, `shell_exec`, `eval`, `exec`, …).
6. Reject schema-qualified table names; enforce the **table whitelist** (CTE aliases are allowed; unknown tables are reported back to the model for self-correction).
7. Enforce the row cap: `LIMIT row_limit + 1` (the sentinel row lets the pipeline mark results as truncated); a model-provided `LIMIT ≤ row_limit` is honored. Non-`SELECT` shapes are wrapped as `SELECT * FROM (…) _limited`.
8. Re-parse the sanitized SQL before returning it.

`extract_table_names()` records which physical tables a query touched (stored on the message and used by dashboard analytics).

#### `schema_cache.py` — schema context

- **Introspection** via the SQLAlchemy inspector: tables sorted by name, with column name/dtype/nullable/primary-key.
- **TTL cache** of 600 s per data source (`schema_cache.get` / `.invalidate`); the schema viewer and the pipeline share it.
- **Relevance heuristic** `select_relevant_tables(schema, question, max_tables=12)`: stopword-filtered token matching against table and column names (with naive singular/plural handling); falls back to the first tables alphabetically when nothing scores.
- Rendering caps: ≤ 40 columns per table in the prompt — keeps prompts small for a 0.5B-class model.

#### `sql_engine.py` — target database engines

- `build_url()` composes SQLAlchemy URLs: `postgresql+psycopg2` (optional `?sslmode=require`), `mysql+pymysql` (utf8mb4), `mssql+pyodbc` (ODBC Driver 18, `TrustServerCertificate=yes`).
- Engines: `pool_pre_ping`, `pool_recycle=1800`, `pool_size=5`, `max_overflow=10`; PostgreSQL additionally gets `connect_timeout=10` and `statement_timeout=30000` (30 s), MySQL a 10 s connect timeout.
- `EngineRegistry` caches one engine per data source (`get` / `invalidate`); passwords are decrypted only when the engine is built.
- `test_connection_params()` runs `SELECT version()` (PostgreSQL/MySQL) or `SELECT @@VERSION` (MSSQL) and reports latency + server version.

#### `analytics.py` — pandas post-processing

- `dataframe_to_payload(df, max_rows)` — JSON-safe conversion (`numpy` ints/floats/bools, `Decimal`, datetimes → ISO, bytes → str, NaN/Inf → `null`) with dtype classification (`boolean | integer | number | datetime | string`) and truncation flag.
- `recommend_chart(df, suggested)` — merges the LLM's chart suggestion with data-shape heuristics: temporal column preferred for the x-axis, up to 3 numeric series; `pie` requires exactly one numeric series and ≤ 8 categories; `scatter` requires numeric x; empty/unsuitable shapes fall back to `table`.
- `build_insight_text(question, df)` — template-based, always-true "facts" (single-row results enumerate every value; multi-row results report row count, first numeric min/max/avg, top category, temporal span).
- `summary_is_grounded(summary, facts)` — the LLM narrative is accepted only if it shares at least one number with the facts (single-row results only), preventing the classic "The user wants to know…" non-answer.

## Frontend Documentation

### Overview

The frontend is a **Next.js App Router application in JavaScript (JSX)** — no TypeScript. It is fully client-interactive (auth, chat, dashboards) with server components used for the root layout only. Path alias `@/*` maps to `src/*`.

`next.config.mjs` enables:

- **`cacheComponents: true`** + **`partialPrefetching: true`** — Next.js 16 caching/prefetching model (the dashboard layout deliberately renders children behind an *auth-gate overlay* instead of early-returning, so every page segment produces a prerenderable instant-navigation shell).
- **`reactCompiler: true`** — React Compiler via `babel-plugin-react-compiler`.
- **Turbopack CSS rule** — Tailwind CSS 4 is wired through `@tailwindcss/turbopack`.

### Routing map

| Route | File | Access | Purpose |
|---|---|---|---|
| `/` | `src/app/page.js` | public | Landing page — hero, feature cards, CTA ("Open workspace" when signed in) |
| `/login` | `src/app/login/page.js` | public | Sign-in form (email + password, show/hide password) |
| `/register` | `src/app/register/page.js` | public | Sign-up form (name, email, password) — auto-logs-in on success |
| `/dashboard` | `src/app/(dashboard)/dashboard/page.js` | auth | Stat cards (questions asked, success rate with progress bar, avg latency, data sources), top-queried tables, recent charts gallery |
| `/chat` | `src/app/(dashboard)/chat/page.js` | auth | The analyst chat — wrapped in `<Suspense>` because it reads `?c=<conversation_id>` via `useSearchParams` |
| `/datasources` | `src/app/(dashboard)/datasources/page.js` | auth | Data-source CRUD, connection testing, schema viewer |
| `*` | `src/app/not-found.js` / `src/app/error.js` | public | 404 page / global error boundary with retry |

The `(dashboard)` **route group** shares `src/app/(dashboard)/layout.js`: a fixed sidebar (Dashboard / Chat / Data Sources) with the `UserMenu` at the bottom, a mobile drawer, and an **auth gate** — while `useAuth()` is loading or the user is absent, a full-screen overlay spinner is shown and the router redirects to `/login`.

### Authentication flow (`src/components/auth-provider.js`)

- `AuthProvider` wraps the whole app (root layout) and exposes `useAuth() → { user, loading, login, register, logout }`.
- **Bootstrap:** on first mount, if `aida_token` exists in `localStorage`, it calls `GET /auth/me`; a failure clears the token.
- **`login(email, password)`:** `POST /auth/login` → stores the JWT → `GET /auth/me` to hydrate the user.
- **`register(...)`:** `POST /auth/register` then immediately logs in.
- **`logout():** clears the token and hard-navigates to `/login`.
- **Global 401 handling:** the fetch wrapper clears the token and redirects to `/login` on any `401` (except on the login page itself).

### API client (`src/lib/api.js`)

- `API_BASE` = `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"`.
- `request(path, options)` attaches `Content-Type: application/json` and `Authorization: Bearer <token>`, parses FastAPI `{ detail }` errors into `ApiError(status, message)`, treats `204` as `null`, and performs the global 401 redirect.
- Exposes typed one-liners mirroring the backend: `register, login, me`, `listDatasources, createDatasource, testDatasource, getSchema, deleteDatasource`, `listConversations, getMessages, deleteConversation`, `overview, recentCharts`.
- **`streamAsk(body, onEvent, signal)`** — `POST /v1/chat/stream` with an `AbortSignal`; reads the body with `response.body.getReader()`, buffers split on `\n\n`, extracts each `data:` line, and parses `{ event, data }` frames for the caller. Malformed frames are ignored; non-OK responses raise `ApiError` with the backend detail.

### Chat page (`src/app/(dashboard)/chat/page.js`)

The most complex screen; state: selected data source, conversation list, active conversation, messages, composer input, streaming flag, live pipeline steps, abort controller.

- **Data-source selector** — auto-selects the first source; switching sources resets and reloads the conversation list (filtered by `datasource_id`).
- **Conversation sidebar** — per-source history; **deep link support**: `/chat?c=<id>` opens that conversation even when it belongs to another data source (the selector switches once the full conversation lookup resolves).
- **Sending** — an optimistic user message is appended, then `streamAsk` runs; `step` events update a live "Analyzing…" card listing `PipelineStepRow`s; the `final` event is converted to a full assistant message (`resultToMessage`). Enter sends, Shift+Enter adds a newline; the composer auto-grows up to ~160 px.
- **Stop button** — swaps the send button while streaming and aborts via `AbortController`.
- **Suggestions** — when no messages exist, quick-start chips are shown (e.g. "Total revenue by month", "Top 10 customers by order value").
- **Message rendering** — `MessageItem` (below) for history; empty chats never linger because the backend titles conversations with the first prompt and self-heals stale `"New chat"` rows.

### Message rendering (`src/components/chat/message-item.js`)

- **User messages** — right-aligned bubble with the user's avatar/initials.
- **Assistant messages** — card with status badges (`Answer`/`Failed`, row count, latency, model short name), the narrative answer, and an error box when failed.
- **Result tabs:** `Chart` (via `ChartRenderer`) · `Data` (full `DataTable`, with a "showing first N of M rows" note when truncated) · `SQL` (mono block + copy button + the model's one-sentence explanation) · `Trace` (deduplicated pipeline steps with status icon, attempt number, latency and detail).
- `PipelineStepRow` labels map raw step ids to friendly names ("SQL generation (Ollama)", "Guardrails (SQLGlot)", …) and renders started/done/error states.

### Chart rendering (`src/components/charts/chart-renderer.js`)

Recharts-based renderer honoring the backend `ChartConfig`:

- **bar** (default), **line**, **area** (25 % fill), **scatter** (numeric x), **pie** (donut style; > 8 categories are grouped into the top-7 plus an "Other" slice), **table** (compact `MiniTable`, first 12 rows).
- Fallbacks: missing/empty rows render a "No data to visualize" placeholder; a non-table chart with no plottable series degrades to the table.
- Shared 8-color palette, trimmed x-axis labels (14 chars), localized number formatting, legends only for multi-series charts.

### Data Sources page (`src/app/(dashboard)/datasources/page.js`)

- **Add dialog** — fields: name, type (PostgreSQL / MySQL / SQL Server with auto-filled default ports 5432/3306/1433), host, port, database, username, password, SSL toggle.
- **Test connection** — calls `/datasources/test` and toasts the measured latency or the failure message.
- **Save** — calls `/datasources`; a failed connection test is rejected server-side (`400`).
- **Delete** — `window.confirm` guard; chat history is preserved (the row's FK is nulled).
- **Schema viewer dialog** — table list with columns (dtype, `PK` / `NOT NULL` badges), plus a **refresh** action that calls `/schema/refresh`.

### Shared components & utilities

| Component / module | Responsibility |
|---|---|
| `theme-provider.js` | `light` / `dark` / `system` theme persisted in `aida_theme`; `ThemeToggle` cycles modes. The root layout injects a pre-paint script that applies the `dark` class before first paint (no theme flash). |
| `user-menu.js` | Sidebar account menu (user identity + logout). |
| `brand.js` | Logo mark + wordmark ("AI Data Analyst · NL → SQL BI Dashboard"). |
| `page-header.js` / `empty-state.js` | Consistent page headers and empty states with optional action buttons. |
| `data-table.js` | Scrollable full result table with dtype badges and formatted cells. |
| `ui/*` | Radix-based primitives: button (CVA variants), card, dialog, select, tabs, input, textarea, label, badge, table, skeleton, avatar (initials fallback). |
| `lib/utils.js` | `cn()` (clsx + tailwind-merge), `initials()` ("Ada Lovelace" → "AL"), `timeAgo()` ("5m ago"). |
| `sonner` toaster | Mounted in the root layout (`richColors`, top-right); used for all success/error toasts. |

### Theming

`globals.css` (Tailwind 4): `@import "tailwindcss";` + `@custom-variant dark (&:is(.dark *));` + `:root` / `.dark` CSS-variable token sets, mapped into Tailwind via `@theme inline` (`--color-background`, `--color-primary`, `--color-border`, …). Components style exclusively with tokens (`bg-card`, `text-muted-foreground`, …), so light/dark switching is pure CSS.

## End-to-End Data Flow

```
Browser                      FastAPI backend                    Ollama        Target DB
   │  POST /api/v1/chat/stream      │                             │              │
   │  {datasource_id, question,     │                             │              │
   │   conversation_id?}            │                             │              │
   ├───────────────────────────────►│ create/reuse conversation   │              │
   │                                │ store user Message          │              │
   │◀── SSE step: schema ───────────┤ introspect (cached ≤600 s)  │              │
   │                                │ select relevant tables      │              │
   │◀── SSE step: sql_generation ──►│──────── structured /api/chat ─────────────►│
   │◀── SSE step: guardrails ───────┤ SQLGlot validate+sanitize   │              │
   │◀── SSE step: execution ───────►│──────── SELECT (LIMIT 1001) ──────────────►│
   │        ↺ on failure: feedback returned to the model, retry ≤3 │              │
   │◀── SSE step: analysis ─────────┤ chart heuristics + insight  │              │
   │                                │ store assistant Message +   │              │
   │                                │ PromptLog rows              │              │
   │◀── SSE final: FinalResult ─────┤                             │              │
   │  render Chart / Data / SQL / Trace tabs                      │              │
```

The non-streaming `POST /api/v1/chat/ask` executes the identical pipeline and returns only the `FinalResult` payload.

## Security Model

| Layer | Control |
|---|---|
| Transport auth | HS256 JWT bearer tokens (24 h default); bcrypt password hashing; inactive accounts rejected at login |
| Multi-tenancy | Data sources, conversations, and analytics are filtered by `owner_id` / `user_id`; cross-user access returns `404` |
| Credential storage | Data-source passwords Fernet-encrypted at rest; key derived from `SECRET_KEY`; decrypted only in-memory per engine build |
| LLM-generated SQL | Read-only enforcement via SQLGlot AST (no DML/DDL/`SET`/…), dangerous-function & pattern blacklist, table whitelist (no schema-qualified names), enforced row cap, re-parse before execution |
| Target DB engines | Pooled, pre-pinged, recycled (30 min); 30 s statement timeout on PostgreSQL; explicit `JOIN … ON` and "no LIMIT" prompt rules reduce runaway queries |
| Prompt audit | Full prompt/response logging in `prompt_logs` for every LLM call and attempt |
| CORS | Explicit origin allow-list with credentials |

## Operational Notes & Limitations

- **Local LLM.** The default model is a 0.5B-parameter Qwen2.5 GGUF — fast and private, but limited. All quality-critical paths have deterministic fallbacks (template insights, chart heuristics, schema-validated JSON). Swap `OLLAMA_MODEL` for a larger model to raise answer quality.
- **Read-only target access is enforced in code, not by DB grants.** Guardrails block write/DDL statements and dangerous functions, but the target database user should *also* be granted only `SELECT` (least privilege — defense in depth).
- **`SECRET_KEY` rotation** invalidates issued JWTs **and** makes stored data-source passwords undecryptable (they must be re-entered).
- **Streaming and proxies.** `X-Accel-Buffering: no` is set for nginx-style proxies; ensure the proxy does not buffer SSE.
- **App database.** PostgreSQL is the default and only fully exercised path; other SQLAlchemy URLs (e.g. SQLite) work for development, with the caveat handled by `_migrate_local_schema()`.
- **Scale limits.** Engine registry and schema cache are in-process (`dict`-based) — deploy behind a single backend worker per instance or externalize the caches for multi-worker setups. Conversation lists are capped at 100; prompt-log and recent-chart queries at 200/24 respectively.
- **No refresh tokens / RBAC.** Sessions are single 24 h JWTs; the legacy `users.role` column is dropped on startup (RBAC removed in v1). All users are peers scoped to their own data.
- **Sample questions** are generic ("Total revenue by month"); they assume a schema containing such tables — adapt them to your data source.

---

*Documentation generated from the source code in `backend/` and `frontend/` — v1.0.0.*









