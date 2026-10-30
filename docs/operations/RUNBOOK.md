# Production Runbook & Operations Guide

## 1. System Overview & Deployment Topology

The **Continuum Backend** is a workspace engine built with **NestJS**, **TypeScript**, **Express**, and **PostgreSQL** with **pgvector**. It provides projects, decisions, tasks, documents, grounded AI chat, and reviewed task proposals. Meetings, Requirements, and Dashboard APIs are retired; their historical database migrations remain for compatibility. See [feature retirement](../product/FEATURE_RETIREMENT.md).

### 1.1 Architecture Topology

```
                         ┌───────────────────────────────────┐
                         │   Client Apps / Browser UI        │
                         │   (Cookie Auth + Double-Submit)   │
                         └─────────────────┬─────────────────┘
                                           │ HTTPS
                                           ▼
                         ┌───────────────────────────────────┐
                         │       Reverse Proxy / Ingress     │
                         │       (TLS Termination, Helmet)   │
                         └─────────────────┬─────────────────┘
                                           │ HTTP (port 43101)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ NestJS Application Container                                                │
│                                                                             │
│  ┌───────────────────────┐  ┌─────────────────────────┐  ┌──────────────┐   │
│  │ Core Domain Modules   │  │ Ingestion & CDC Outbox   │  │ AI & Context │   │
│  │ (Auth, Projects, Docs,│  │ (Chunking, Vector Store, │  │ (Retrieval,  │   │
│  │  Tasks, Decisions)    │  │  Transactional Outbox)   │  │  Proposals)  │   │
│  └──────────┬────────────┘  └────────────┬────────────┘  └───────┬──────┘   │
│             │                            │                       │          │
└─────────────┼────────────────────────────┼───────────────────────┼──────────┘
              │                            │                       │
      TypeORM │ (Port 5432)                │                       │ HTTPS
              ▼                            ▼                       ▼
┌──────────────────────────────┐ ┌───────────────────┐ ┌──────────────────────┐
│ PostgreSQL 16 + pgvector     │ │ Storage Driver    │ │ AI Model Providers   │
│  - Relational Tables         │ │  - Local Files    │ │  - DeepSeek V4 Pro   │
│  - HNSW Vector Indexes       │ │    (./var/uploads)│ │    (Reasoning/Chat)  │
│  - GIN Full-Text Indexes     │ │  - S3 / MinIO     │ │  - OpenAI Embeddings │
│  - CDC Outbox Queue          │ │    (Object Store) │ │    (3-small, 1536-d) │
└──────────────────────────────┘ └───────────────────┘ └──────────────────────┘
```

### 1.2 Core Architectural Principles

1. **Decoupled AI & Storage**: Core workspace operations function independently of AI availability. If AI providers are unavailable, standard CRUD and search fallback remain 100% operational.
2. **Provider Separation**: Preserve the explicitly configured generation model. The application default and established local runtime use DeepSeek `deepseek-flash`; `deepseek-v4-pro` is supported as an explicit choice. Embeddings default to pinned local Qwen3-Embedding 0.6B via Ollama, 1024 dimensions; OpenAI and keyword-only modes are explicit alternatives. DeepSeek credentials are never sent to embedding endpoints. Retrieval changes do not authorize changing models or existing vector identities.
3. **Transactional Proposals**: AI output is untrusted. Task suggestions require explicit human confirmation with an idempotency key and current proposal version before persistence.
4. **Access Isolation**: Cross-project queries return `404 Not Found` (never `403`) to eliminate resource enumeration and privacy leaks.

---

## 2. Environment Variables Checklist & Configuration

All environment variables are validated at boot against the Zod schema in `src/config/environment.ts`. The application fails fast if any required variable is missing or malformed.

| Variable Name              | Type / Format                                                | Default                           | Description & Operational Notes                                                           |
| -------------------------- | ------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development \| production \| test`                          | `development`                     | Setting to `production` enforces `__Host-` cookie prefixes, TLS cookies, and strict CORS. |
| `PORT`                     | Integer (1–65535)                                            | `43101`                           | HTTP listen port.                                                                         |
| `APP_ORIGIN`               | URL                                                          | `http://localhost:43100`          | Allowed frontend origin for CORS and CSRF header validation.                              |
| `DATABASE_HOST`            | Hostname / IP                                                | `127.0.0.1`                       | PostgreSQL database host.                                                                 |
| `DATABASE_PORT`            | Integer                                                      | `43104`                           | PostgreSQL database port (Local dev: `43104`, Test: `43105`, Prod: `5432`).               |
| `DATABASE_NAME`            | String                                                       | `ai_workspace`                    | PostgreSQL database name.                                                                 |
| `DATABASE_USER`            | String                                                       | `ai_workspace_app`                | Dedicated least-privilege PostgreSQL user.                                                |
| `DATABASE_PASSWORD`        | String                                                       | _Required_                        | Strong database user password.                                                            |
| `DATABASE_SSL`             | Boolean                                                      | `false`                           | Enable TLS verification for database connections in staging/prod.                         |
| `STORAGE_DRIVER`           | `local \| s3`                                                | `local`                           | Object storage backend. In production clusters, configure `s3` with MinIO or AWS S3.      |
| `STORAGE_LOCAL_ROOT`       | File path                                                    | `./var/uploads`                   | Path to persistent volume for local file storage.                                         |
| `MAX_UPLOAD_BYTES`         | Integer (bytes)                                              | `20971520` (20 MiB)               | Maximum allowed file upload size. Validated in streaming parser.                          |
| `SESSION_IDLE_HOURS`       | Integer (hours)                                              | `8`                               | Sliding window inactivity timeout for user sessions.                                      |
| `SESSION_ABSOLUTE_DAYS`    | Integer (days)                                               | `7`                               | Maximum absolute lifespan of a session regardless of activity.                            |
| `LOG_LEVEL`                | `fatal \| error \| warn \| info \| debug \| trace \| silent` | `info`                            | Logging verbosity via structured Pino logger.                                             |
| `AI_ENABLED`               | Boolean                                                      | `false`                           | Global feature flag enabling AI chat, context retrieval, and proposals.                   |
| `DEEPSEEK_API_KEY`         | String                                                       | _Optional_                        | DeepSeek platform credential for the configured generation model only.                    |
| `DEEPSEEK_BASE_URL`        | URL                                                          | `https://api.deepseek.com`        | DeepSeek API base URL.                                                                    |
| `AI_CHAT_MODEL`            | `deepseek-flash \| deepseek-v4-pro`                          | `deepseek-flash`                  | Preserve the installation's explicit model selection.                                     |
| `AI_EMBEDDING_PROVIDER`    | `disabled \| mock \| openai \| ollama`                       | `ollama`                          | Local Qwen by default; disabled is keyword-only. Mock is for tests.                       |
| `OPENAI_API_KEY`           | String                                                       | _Optional_                        | OpenAI API key for `text-embedding-3-small`.                                              |
| `AI_EMBEDDING_MODEL`       | String                                                       | `qwen3-embedding:0.6b` for Ollama | Provider-aware default: explicit OpenAI uses `text-embedding-3-small`.                    |
| `AI_EMBEDDING_DIMENSIONS`  | Integer                                                      | `1024` for Ollama                 | Provider-aware default: explicit OpenAI uses `1536`. Preserve existing identities.        |
| `AI_OLLAMA_MODEL_REVISION` | Digest                                                       | Pinned in configuration/schema    | Verify installed model identity before indexing; see the local embeddings guide.          |
| `GITHUB_CLIENT_ID`         | String                                                       | _Optional_                        | GitHub OAuth App client ID for repository sync.                                           |
| `GITHUB_CLIENT_SECRET`     | String                                                       | _Optional_                        | GitHub OAuth App client secret.                                                           |
| `GITHUB_WEBHOOK_SECRET`    | String                                                       | _Optional_                        | Secret for validating inbound GitHub webhook HMAC-SHA256 signatures.                      |

---

## 3. Database Migrations & Release Deployment

### 3.1 Migration Execution Rule

- `synchronize: false` and `migrationsRun: false` are strictly enforced across all environments.
- Migrations must be run as an explicit step during the container release phase.

### 3.2 Deployment Workflow

1. **Pre-Deployment Backup**:
   ```bash
   pg_dump -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -Fc -f "/backups/pre-deploy-$(date +%s).dump"
   ```
2. **Inspect Migration Status**:
   ```bash
   pnpm migration:show
   ```
3. **Execute Pending Migrations**:
   ```bash
   # Development / Staging:
   pnpm migration:run

   # Production Docker Container:
   pnpm migration:run:prod
   ```
4. **Deploy Application Container**:
   ```bash
   docker compose --profile app up -d --build
   ```
5. **Verify Readiness Probe**:
   ```bash
   curl -f http://localhost:43101/api/v1/health/ready
   # Expected: {"data":{"status":"ok"}}
   ```

---

## 4. Backup & Disaster Recovery (DR)

### 4.1 Automated Backup Strategy

- **Frequency**: Automated daily full snapshots (`pg_dump -Fc`), hourly WAL archive shipping for Point-in-Time Recovery (PITR).
- **Retention**: 30 days daily backups, 12 months monthly archives.

### 4.2 Snapshot Backup Command

```bash
# Create binary compressed backup with BLOBs
pg_dump \
  -h "${DATABASE_HOST:-127.0.0.1}" \
  -p "${DATABASE_PORT:-43104}" \
  -U "${DATABASE_USER:-ai_workspace_app}" \
  -d "${DATABASE_NAME:-ai_workspace}" \
  -Fc \
  -f "./backups/ai_workspace_$(date +%Y%m%d_%H%M%S).dump"
```

### 4.3 Database Restoration Procedure

```bash
# 1. Terminate existing application connections
psql -h "${DATABASE_HOST}" -U postgres -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'ai_workspace' AND pid != pg_backend_pid();"

# 2. Drop and recreate clean database with vector extension
psql -h "${DATABASE_HOST}" -U postgres -d postgres -c "DROP DATABASE IF EXISTS ai_workspace;"
psql -h "${DATABASE_HOST}" -U postgres -d postgres -c "CREATE DATABASE ai_workspace OWNER ai_workspace_app;"
psql -h "${DATABASE_HOST}" -U postgres -d ai_workspace -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 3. Restore snapshot
pg_restore \
  -h "${DATABASE_HOST:-127.0.0.1}" \
  -p "${DATABASE_PORT:-43104}" \
  -U "${DATABASE_USER:-ai_workspace_app}" \
  -d "${DATABASE_NAME:-ai_workspace}" \
  --no-owner \
  --role=ai_workspace_app \
  "./backups/ai_workspace_target.dump"
```

### 4.4 Restoration Verification (DR Smoke Test)

Run the automated schema and index verification harness:

```bash
npx ts-node scripts/backup-restore-smoke.ts
```

The script validates:

- Presence of all 15 core relational tables.
- Record counts and referential integrity.
- `vector` extension installation and version.
- GIN full-text index definitions across requirements, decisions, tasks, documents, and meetings.

---

## 5. Zero-Downtime Secret Rotation

### 5.1 Database Password Rotation

1. In PostgreSQL, create a secondary credential or rotate the password for `ai_workspace_app`:
   ```sql
   ALTER USER ai_workspace_app WITH PASSWORD 'NewUltraSecurePassword2026!';
   ```
2. Update the `DATABASE_PASSWORD` in secret manager / environment file.
3. Perform a rolling restart of the NestJS application containers.

### 5.2 AI Provider Key Rotation (`DEEPSEEK_API_KEY` / `OPENAI_API_KEY`)

1. Provision a new API key in the provider dashboard (DeepSeek Platform or OpenAI Console).
2. Update `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` in environment variables.
3. Execute rolling restart of application instances. Active sessions and database transactions are unaffected.
4. Revoke the old API key in the provider console after verification.

### 5.3 Session & Cookie Security

- Session cookies are opaque 256-bit cryptographically secure random tokens stored hashed (`SHA-256`) in the database.
- Immediate revocation:
  - Single session: `POST /api/v1/auth/logout`.
  - All user sessions: `POST /api/v1/users/me/revoke-sessions` (or admin deactivation).
- Sliding idle expiration is enforced on every authenticated request.

---

## 6. End-to-End Operational Demo Script (10-Step Scenario)

Follow this step-by-step procedure to demonstrate the full capabilities of the AI Workspace platform:

### Step 1: Bootstrap & Authentication

Log in with test credentials to obtain an authenticated session cookie and CSRF token:

```bash
curl -i -X POST http://localhost:43101/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Password123!"}'
```

_Verify: Returns HTTP 200, `Set-Cookie: aiws_session=...; HttpOnly; SameSite=Lax`, and `data.csrfToken` in response body._

### Step 2: Create a Collaborative Project

```bash
curl -X POST http://localhost:43101/api/v1/projects \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Autonomous Fleet Management","slug":"fleet-mgmt","key":"FLEET"}'
```

_Verify: Returns HTTP 201 with project ID and key `FLEET`._

### Step 3: Ingest a Specification Document

Upload a system architecture specification document (`PDF`, `DOCX`, or `TXT`):

```bash
curl -X POST http://localhost:43101/api/v1/projects/$PROJECT_ID/documents \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -F "file=@spec.pdf" \
  -F "title=Fleet Architecture Spec"
```

_Verify: Returns HTTP 201 with document ID and status `PENDING`. Background worker chunks and indexes content into vector store._

### Step 4: Hybrid Knowledge Search

Search indexed project documents and active workspace records:

```bash
curl "http://localhost:43101/api/v1/projects/$PROJECT_ID/search?q=telemetry+protocol" \
  -b "aiws_session=$SESSION_COOKIE"
```

_Verify: Returns HTTP 200 with aggregated results and `countsByType`._

### Step 5: Start Grounded AI Conversation

Create an AI conversation and send a grounded question:

```bash
curl -X POST http://localhost:43101/api/v1/projects/$PROJECT_ID/ai/conversations \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Architecture Review","defaultMode":"DEV"}'
```

### Step 6: Query AI with Citations

```bash
curl -X POST http://localhost:43101/api/v1/projects/$PROJECT_ID/ai/conversations/$CONV_ID/messages \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"What telemetry protocol should the edge nodes use?"}'
```

_Verify: Returns synthesized response with valid Markdown citation badges referencing the uploaded document._

### Step 7: Record an Architecture Decision

Create a decision in the project:

```bash
curl -X POST http://localhost:43101/api/v1/projects/$PROJECT_ID/decisions \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Use signed A/B firmware updates","decisionText":"Firmware updates must use cryptographically signed A/B images.","rationale":"This supports safe rollback and verifies the publisher."}'
```

_Verify: Returns HTTP 201 with the new decision ID. Save it as [36m[1m$DECISION_ID[0m for the next step._

### Step 8: Generate and Review Task Drafts

Generate an editable proposal from that decision:

```bash
curl -X POST http://localhost:43101/api/v1/projects/$PROJECT_ID/ai/decisions/$DECISION_ID/task-proposals \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN"
```

Review or edit the returned pending proposal before confirming it. Generation alone creates no tasks.

### Step 9: Confirm the Reviewed Proposal

Confirm only after reviewing the task draft. Use a fresh idempotency key for this confirmation and reuse it for retries:

```bash
curl -X POST http://localhost:43101/api/v1/projects/$PROJECT_ID/ai/proposals/$PROPOSAL_ID/confirm \
  -b "aiws_session=$SESSION_COOKIE" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -H "Idempotency-Key: demo-key-001" \
  -H "Content-Type: application/json" \
  -d '{"version":1}'
```

_Verify: Returns HTTP 200 with the proposal and created task IDs. Replaying with the same key and payload does not create duplicate tasks._

### Step 10: Verify the Project Task Board

```bash
curl "http://localhost:43101/api/v1/projects/$PROJECT_ID/tasks" \
  -b "aiws_session=$SESSION_COOKIE"
```

_Verify: The confirmed tasks appear in the project task list. Meetings, Requirements, and Dashboard routes are retired; see [feature retirement](../product/FEATURE_RETIREMENT.md) for compatibility details._
