# OSCAR Backend

The API and orchestration layer for OSCAR, a personal AI chief of staff. It owns
workspace records, private conversations, reviewed memory, project retrieval,
and supervised work delegated to connected agents.

Built with **NestJS 11, TypeScript, TypeORM, PostgreSQL 17, and pgvector**, with an
Express HTTP API and a stdio Model Context Protocol server.

## Repository responsibilities

| Repository                                                            | Responsibility                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **oscar-backend**                                                     | Authentication, domain data, conversation context, retrieval, MCP, and agent orchestration |
| [oscar-frontend](https://github.com/mengchheanglong/oscar-frontend)   | Browser application and human review interface                                             |
| [oscar-knowledge](https://github.com/mengchheanglong/oscar-knowledge) | Independent reference ingestion and evidence-only retrieval                                |

MAVIS is OSCAR's memory and continuity layer within this application. The
independent Knowledge service supplies reference evidence; it does not generate
OSCAR answers or own project records.

## Capabilities

- Cookie sessions, CSRF protection, personal access tokens, project membership,
  and action-level authorization.
- Projects, goals, tasks, architecture decisions, activity, and reviewed AI
  proposals with version checks and idempotent confirmation.
- Private conversations, bounded recent context, durable summaries, reviewed
  memory, history recall, and context exclusions.
- Chat-scoped attachments, explicit promotion to project knowledge, shared
  documents, private folder copies, and GitHub source synchronization.
- Keyword, semantic, and hybrid retrieval with source provenance and citations.
- Shared skill guidance and supervised Hermes, T3, and Paperclip handoffs with
  persisted status, results, and outcome review.
- MCP tools for permitted workspace operations and reviewed proposals.

Meetings, requirements, and the old dashboard are retired. Historical data and
migration identifiers remain preserved. The reference topic graph supports bounded
source discovery. Feature
implementation does not establish that every runtime or deployment is configured.

## Local development

### Requirements

- Node.js **24.14.0** and pnpm **10.32.1**, matching the repository pins.
- Docker with Compose v2 for local PostgreSQL services.
- Ollama with pinned **Qwen3-Embedding 0.6B** for default embeddings, or an explicit
  keyword-only configuration.
- Separate provider credentials when enabling answer generation.

Keep the repositories in sibling folders:

```text
OSCAR/
  oscar-backend/
  oscar-frontend/
  oscar-knowledge/
```

Run from `oscar-backend`. PowerShell examples are shown.

```powershell
pnpm install --frozen-lockfile
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Review .env before starting services or applying migrations.
pnpm db:up
pnpm migration:run
pnpm dev
```

For a new installation, set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`
in private configuration if initial administrator bootstrap is needed. Bootstrap
only creates an administrator when none exists. Do not seed a persistent
installation or replace an existing `.env` during normal startup.

### Local endpoints

| Component                 | Endpoint / port                       |
| ------------------------- | ------------------------------------- |
| Web application           | `http://localhost:43100`              |
| API                       | `http://127.0.0.1:43101/api/v1`       |
| Swagger, when enabled     | `http://127.0.0.1:43101/api/docs`     |
| Main PostgreSQL           | `127.0.0.1:43104`                     |
| Isolated test PostgreSQL  | `127.0.0.1:43105`                     |
| Optional Redis            | `127.0.0.1:43106`                     |
| T3 / Paperclip            | `127.0.0.1:43102` / `127.0.0.1:43103` |
| Independent Knowledge API | `http://127.0.0.1:8010`               |
| Local Ollama              | `http://127.0.0.1:11434`              |

API health endpoints are `/api/v1/health/live` and `/api/v1/health/ready`.
API readiness does not replace checking model and agent dependencies.

## Configuration

Use [.env.example](.env.example) as the configuration inventory. Credentials and
machine-specific paths belong in ignored local configuration.

| Concern                    | Checked-in configuration                                                           |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Answer generation          | `AI_ENABLED=false`; DeepSeek adapter, `deepseek-flash` model                       |
| Main embeddings            | `ollama`, `qwen3-embedding:0.6b`, 1024 dimensions, pinned revision                 |
| Reference service          | `OSCAR_KNOWLEDGE_ENABLED=false`; configure the independent service before enabling |
| Required-source policy     | `OSCAR_KNOWLEDGE_REQUIRED=false`; configurable installation policy                 |
| Private storage            | `STORAGE_DRIVER=local`; back up the storage root with the database                 |
| Hermes                     | Disabled until its Python runtime and provider are prepared                        |
| Automatic history indexing | Disabled until explicitly enabled with configured limits                           |

### Models and retrieval

Generation and embeddings are separate dependencies. Enabling DeepSeek requires
its own credential; it does not configure embeddings. Main embeddings default to
pinned local Qwen 0.6B. Install and warm the model, verify its full revision
digest, and follow the [embedding guide](docs/operations/LOCAL_EMBEDDINGS.md)
before indexing or changing providers. Startup does not download model weights.

Set `AI_EMBEDDING_PROVIDER=disabled` for keyword-only operation without Ollama.
OpenAI embeddings remain an explicit alternative with separate credentials.
There is no automatic fallback from local embedding failures to a paid provider.
Existing vector identities are preserved during supported migrations; switching
providers can require deliberate re-indexing.

### Reference knowledge and required sources

The proposed [knowledge intelligence roadmap](docs/architecture/KNOWLEDGE_INTELLIGENCE_ROADMAP.md)
defines phased work on numerical validation, complete answers, section retrieval,
source quality, graph discovery and business-outcome feedback. It is a plan,
not a statement that those capabilities are already complete.

For real business-question acceptance, see the
[business usefulness evaluation](docs/architecture/BUSINESS_USEFULNESS_EVALUATION.md).
It separates live retrieval/provenance checks from semantic and actionability
review, with private development and reserved question sets.
The [Phase 0 baseline guide](docs/architecture/PHASE_0_BASELINE.md) documents
duration-only stage telemetry, frozen datasets and isolation from evaluation-chat
history.

The [Phase 1 calculation guide](docs/architecture/PHASE_1_CALCULATIONS.md) describes
typed, exact business arithmetic and saved receipts in assistant/MCP answers.
It documents the bounded operations, source-gap behavior and remaining retrieval
and answer-completeness limitations.

The [Phase 3 retrieval guide](docs/architecture/PHASE_3_EXPLANATORY_RETRIEVAL.md)
documents concept-aware searches, permissioned passage windows, MCP inspection,
rollback controls and remaining calculation/latency limits.

The [Phase 2 answer guide](docs/architecture/PHASE_2_ANSWER_COVERAGE.md) describes
whole-unit support review, post-review coverage, a single evidence-only redraft,
calculator preservation and rollout controls. Structural coverage is distinct
from independently verified semantic completeness.

Connect the independent service using the
[Knowledge integration guide](docs/operations/KNOWLEDGE_LOCAL.md). It requires a
service token and, for private references, a separate backend-only signing
secret. Private ownership or exact-book reader grants remain enforced.

Optional mode lets the user control reference retrieval per turn. Required mode
forces retrieval for ordinary Assistant turns and withholds unsupported drafts
when current citations are missing. It is not an enforcement layer for external
agent outputs, nor a guarantee of factual accuracy or semantic claim support.

### Files, memory, and authorization

Composer uploads belong to one private chat and stay outside the shared project
index. A user can explicitly promote a file to project knowledge or review and
save a short private memory. Existing uploads retain their project knowledge
scope. Attachment-bearing chats are excluded from cross-chat recall; removal
invalidates earlier derived assistant context. See
[chat attachments](docs/product/CHAT_ATTACHMENTS.md) for formats, limits, and retention.

Retrieved documents, messages, skills, and agent outputs are untrusted context.
They cannot grant permissions. AI-generated changes remain drafts until normal
authorization, explicit user confirmation, version checks, and transactional
persistence succeed.

## Running the workspace

For an already configured Windows installation with both applications built:

```powershell
pnpm workspace:start
pnpm workspace:status
```

The launcher runs explicit migrations, reuses healthy processes, and starts
configured local services. It requires prepared external runtimes; it does not
install them. For core startup without T3 and Paperclip:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -SkipAgents
```

For the Docker application profile, start PostgreSQL, migrate, then build/start:

```powershell
pnpm db:up
docker compose --profile migrations run --rm migrate
pnpm stack:up
```

Follow the [Docker guide](docs/operations/DOCKER_LOCAL.md) for existing volumes,
upload mounts, and host/container model identities. The Node image does not
bundle the Hermes Python runtime. Never delete volumes or reset a database to
repair an existing installation.

## MCP integration

Build the backend and configure the client to launch:

```text
node <absolute-backend-path>/dist/mcp/cli.js
```

| Variable           | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `OSCAR_API_URL`    | Reachable API base, for example `http://127.0.0.1:43101/api/v1` |
| `OSCAR_API_KEY`    | Personal access token from the authenticated OSCAR account      |
| `OSCAR_PROJECT_ID` | Default project key or UUID                                     |

The stdio process forwards operations to the authenticated API; it does not
bypass membership or access storage directly. Keep tokens in private client
configuration and restart MCP clients after rebuilding. Inspect and edit AI
proposals before confirming selected, user-authorized items; reuse the same
idempotency key when retrying a confirmation.

The assistant workflow is also available through MCP:

- `upload_document_text` uploads authorized Markdown/plain text (up to 100,000
  characters) through the normal project document pipeline; use `get_document`
  to check indexing completion. The tool accepts content, not arbitrary local paths.
- `create_assistant_conversation` creates a private, project-scoped chat.
- `ask_assistant` enables permitted knowledge retrieval and returns the saved
  answer, citations and evidence snapshot. Supply a stable `clientRequestId` UUID
  and reuse the identical request on retries, including after a proxy error.
- `get_assistant_messages` reads the latest twenty saved messages without generation.

A completed message can still contain a withheld answer: inspect the answer text
and `evidenceSnapshot.answerReview`, not just `status`. Evidence inclusion and
citation counts do not establish semantic accuracy. These tools create no accepted
business decisions or tasks. Business-plan reviews use bounded searches for
customer strategy, marketplace dynamics and subscription economics; focused
questions retain their existing retrieval path and all private-reader checks.

Business reviews use focused natural-language aspect questions, retain up to
twelve distinct source passages (two per source), and allow one follow-up for an
aspect with no usable results, within the existing shared deadline. A private
`evidenceSnapshot.retrievalAudit` records aspect searches, candidate/selected IDs,
timing and deadline/retry outcomes; zero usable hits is a heuristic coverage
signal, not proof of missing knowledge. This is relevance selection and duplicate
removal, not a neural reranker.

Only business reviews use the larger 32,000-character source ceiling, reserving
up to 26,000 for references and 5,000 for project sources. Full retrieved passages
are preferred; necessary truncation favors sentence/line boundaries. These are
character limits, not exact tokenizer counts. Source-support review v4 preserves
section attribution and quoted-question continuations; inherited recommendations
remain explicitly labelled when published. All source anchors and claim checks
remain required. No extraction, vector migration or reader expansion is involved.

Positioning requests preserve the user's primary/additional value choices and
search customer-benefit and positioning principles rather than forcing a general
strategy audit. Current user intent is an input, not proof of market validation.
Explicit cross-source synthesis is distinguished from an unsolicited project
application. Quoted source names receive bounded individual searches; when all
requested sources have usable candidate passages, comparisons stay within those
sources unless broader sources were requested. Missing sources are not replaced
silently with another author's premise. Support review v5 permits labelled
conditional synthesis with anchored premises, while retaining every factual,
scope, numeric and causality check. This does not summarize or validate every
book in the library.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm db:test:up
pnpm test:integration
pnpm build
pnpm openapi:generate
pnpm format:check
```

Database integration tests use a dedicated `_test` database and an isolated
per-run database. Never point them at development or deployment data.
`pnpm verify:foundation` checks the backend and sibling frontend; add
`--integration` after starting the test database. Knowledge has its own Python
verification workflow.

Live provider and upstream-agent checks are separate from deterministic tests
and may require credentials, execution permissions, and provider usage. Consult
the dated progress ledger for checks actually performed rather than treating
historical test counts as a current readiness guarantee.

## Documentation

- [Reference retrieval reliability and synthesis limits](docs/architecture/REFERENCE_RETRIEVAL_RELIABILITY.md)

- [Reference topic graph and MCP browsing](docs/architecture/KNOWLEDGE_GRAPH.md)

- [Documentation map](docs/README.md)
- [Product vision and architecture](docs/product/OSCAR_MAVIS_Vision_and_Architecture.md)
- [Implementation guide and progress ledger](PROJECT_IMPLEMENTATION_GUIDE.md)
- [Local development](docs/operations/LOCAL_DEVELOPMENT.md) and [operations runbook](docs/operations/RUNBOOK.md)
- [Goals, briefings, and outcome reviews](docs/product/CHIEF_OF_STAFF_WORKFLOW.md)
- [Agent handoffs](docs/product/OSCAR_AGENT_HANDOFFS.md) and [Hermes runtime](docs/architecture/HERMES_RUNTIME.md)
- [Shared skills](docs/product/SHARED_SKILLS.md)
- [Conversation context](docs/memory/CONVERSATION_CONTEXT.md) and [history recall](docs/memory/CONVERSATION_HISTORY_RECALL.md)
- [Generated API contract](docs/api/openapi.json)
- [Feature retirement](docs/product/FEATURE_RETIREMENT.md)

Active development uses `main`. Historical AI Workspace/Continuum names remain
in compatible identifiers and migrations; do not rename records or delete volumes
for branding consistency. Local Compose is a development configuration. Public
deployment requires separate secrets, TLS, access controls, persistent storage,
backups, and runtime provisioning.
