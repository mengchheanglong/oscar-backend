# OSCAR — Backend

## Current product plan: OSCAR & MAVIS

The [OSCAR & MAVIS vision and architecture](docs/product/OSCAR_MAVIS_Vision_and_Architecture.md)
is the new product direction supplied on 18 October 2026. OSCAR is the personal,
goal-driven AI Chief of Staff; MAVIS is its shared memory and continuity system.
The existing Continuum frontend and backend remain the engineering foundation.

Start with the [Phase 0 foundation](docs/product/OSCAR_MAVIS_FOUNDATION.md) for the current
baseline, system boundaries, known gaps, and repeatable cross-repository checks:
`pnpm verify:foundation` (add `--integration` for the isolated local database).

Use the blueprint's [implementation roadmap](docs/product/OSCAR_MAVIS_Vision_and_Architecture.md#15-implementation-roadmap)
for new planning, beginning with Phase 0: preserve and verify the current baseline.
Its [first MVP](docs/product/OSCAR_MAVIS_Vision_and_Architecture.md#16-the-first-mvp-i-would-actually-build)
connects a real goal, approved memory, and one supervised external agent workflow.
The [Phases 1–3 implementation](docs/product/OSCAR_MAVIS_PHASES_1_3.md) adds goals,
approved MAVIS memory, and platform activity. The [T3 chat handoff](docs/product/OSCAR_T3_HANDOFF.md)
adds reviewed, supervised execution and returns T3's result to OSCAR chat.
The [shared agent handoff guide](docs/product/OSCAR_AGENT_HANDOFFS.md) covers Hermes,
T3 and Paperclip execution, result summaries and configuration. The inherited
implementation guide remains a record of the foundation and its verification history.

The [chief-of-staff workflow](docs/product/CHIEF_OF_STAFF_WORKFLOW.md) adds goal-linked
execution, human outcome reviews, proposed MAVIS lessons, opt-in recurring
briefings and user-reported execution spending. Windows startup and live readiness
are available through `pnpm workspace:start` and `pnpm workspace:status`; see
[local development](docs/operations/LOCAL_DEVELOPMENT.md).

The [documentation map](docs/README.md) groups the product, architecture, memory,
evaluation, operations, and API references by topic.

The [shared skills guide](docs/product/SHARED_SKILLS.md) documents Customize, the
central personal skill library, persistent chat commands, and agent/MCP access.
The [Founder pack installation](docs/product/FOUNDER_SKILLS.md) describes the 11
imported business modes, pinned source, and instruction-mode boundaries.

## Existing foundation

Current scope: Meetings, Requirements, and Dashboard functionality have been
retired. See [feature retirement](docs/product/FEATURE_RETIREMENT.md) for removed API/MCP
contracts, preserved data, and verification. This supersedes the inherited
foundation-era feature inventory below.

For host development and the full Docker app, see
[Running Continuum locally](docs/operations/DOCKER_LOCAL.md). The Docker app profile includes
the sibling frontend repository and uses ports 43100 (web) and 43101 (API).

Continuum is a personal, chat-first workspace for business, finance, research,
project files, tasks, decisions, and AI-assisted work. This is an independent
repository derived from AI Workspace's develop branch, with its Git history
preserved. The original AI Workspace repositories remain separate.

- Frontend: https://github.com/mengchheanglong/oscar-frontend
- Backend: https://github.com/mengchheanglong/oscar-backend
- Working branch: `develop`; GitHub default branch: `main`.
- Local frontend: `http://localhost:43100`; local API: `http://127.0.0.1:43101`.
- Environment files, access tokens, uploaded content, and machine MCP settings
  stay local and are not part of this repository.

The inherited implementation guide and verification notes describe the original
foundation. The OSCAR & MAVIS blueprint above defines the new product direction.
Legacy `aiw_*` storage keys, API environment names, database migration identifiers,
and the existing isolated development database remain compatible with current
local data. Repository branding changes do not migrate or reset that data.

NestJS backend foundation for Continuum. Read the OSCAR & MAVIS blueprint for the
current plan and [PROJECT_IMPLEMENTATION_GUIDE.md](PROJECT_IMPLEMENTATION_GUIDE.md)
for the inherited architecture, API conventions, and implementation history.

## What exists

- NestJS 11, Express, strict TypeScript, TypeORM, PostgreSQL/pgvector.
- Validated environment configuration; structured Pino logging; request IDs; safe errors; Helmet; explicit-origin CORS; global DTO validation.
- Health endpoints, Swagger UI, and offline OpenAPI generation.
- Explicit migration workflow, isolated database tests, Docker Compose, and a GitHub Actions CI workflow.
- Pinned Node/pnpm versions and a pnpm lockfile.

Core workspace modules, authentication, documents, ingestion/retrieval, cited
copilot chat, reviewed proposals and GitHub integration are implemented. The
operational extension adds Workspace mode, reviewed private memory, and a bounded
Hermes agent execution path. Read the guide's latest progress ledger for actual
verification and release limitations; foundation-era instructions below are not
a current feature-status inventory.

AI uses the existing configured DeepSeek provider/model. Embeddings have separate
settings. Optional Hermes execution remains disabled by default and needs a
prepared Python/source environment plus explicit database migrations. See
[Hermes runtime setup](docs/architecture/HERMES_RUNTIME.md); the Node-only Docker image does
not bundle Hermes. The current local environment is enabled and passed a real
DeepSeek V4 Pro workflow; production runtime packaging/deployment remains pending.

Normal chat supports bounded history and durable conversation summaries. Apply
the explicit context migration before running the updated backend; see
[conversation context](docs/memory/CONVERSATION_CONTEXT.md) for the budget, connection
requirements, and rollout status. The budget uses conservative byte estimates,
not an exact DeepSeek token count.

Older private dialogue can also be retrieved within the owning user/project.
[History recall and exclusions](docs/memory/CONVERSATION_HISTORY_RECALL.md) explains the
retrieval, exclusion control, dependency invalidation and required migrations.
Optional [semantic history recall](docs/memory/SEMANTIC_HISTORY_RECALL.md) adds compatible
pgvector embeddings through explicit bounded indexing or optional
[automatic history indexing](docs/memory/AUTOMATIC_HISTORY_INDEXING.md) with persistent
daily limits and retries. Read the
[evaluation results](docs/evaluation/HISTORY_RECALL_EVALUATION.md) for measured gains and limits.
The [English answer evaluation](docs/evaluation/HISTORY_ANSWER_EVALUATION.md) checks actual
generated answers, including corrections, exclusions, private scope and compaction.

## Prerequisites

For current manual testing on develop, use the separate local database and server
targets in [Isolated local development](docs/operations/LOCAL_DEVELOPMENT.md). Local testing
must not use the deployment database.

Team is scoped to yourself and active collaborators sharing a project. Pending
invitations belong to their sender; foreign invitation cancellation is rejected.
Inviting a system administrator requires an administrator account.

Read-only local folder sources are available through Documents. Selected text is
indexed privately for the owning account and project; original files remain on
the user's computer. See [folder sources](docs/operations/LOCAL_FOLDER_SOURCES.md) for the
browser connector, data transfer, rescan/disconnect workflow, and limits.

- Node.js **24.14.0**, as pinned in `.node-version`.
- pnpm **10.32.1**, as pinned in `package.json` (`npm install --global pnpm@10.32.1` if needed).
- Docker with Compose and a running Docker engine.

NestJS 11 is pinned for the CommonJS/Jest toolchain; `@nestjs/config` is pinned at v4 because v12 is ESM-only. TypeScript 5.9 and TypeORM 0.3 are also pinned to keep the toolchain compatible. You do not need a global Nest CLI.

## Start local development

Run from this repository. On first setup only, copy the environment example:

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm db:up
pnpm migration:run
pnpm dev
```

On macOS/Linux, use `cp .env.example .env`. Do not overwrite an existing configured `.env` during later updates. The initial setup task already creates the local `.env` and installs dependencies.

- API liveness: [http://localhost:43101/api/v1/health/live](http://localhost:43101/api/v1/health/live)
- API readiness: [http://localhost:43101/api/v1/health/ready](http://localhost:43101/api/v1/health/ready)
- Swagger UI (local development): [http://localhost:43101/api/docs](http://localhost:43101/api/docs)
- Runtime OpenAPI JSON: [http://localhost:43101/api/docs-json](http://localhost:43101/api/docs-json)

The project defaults to port **43101**. Host development PostgreSQL is on **43104**. Update `.env` deliberately if local ports change; Compose has explicit mappings and does not inherit all `.env` runtime values.

There is no root `/` page; use the routes above. A successful response is `{"data":{"status":"ok"}}`. Readiness checks PostgreSQL and a temporary write/delete probe under local upload storage; it returns a generic 503 if either is unavailable. The API currently requires the database at startup. After startup, database failure causes readiness to fail while liveness remains available.

## Run the containerized local stack

```powershell
pnpm stack:up
```

This builds the API image, starts PostgreSQL, runs migrations in a one-shot release container, then starts the API on port 43101. Do not run `pnpm dev` on the same port simultaneously. To switch to host development:

```powershell
docker compose --profile app stop api
pnpm dev
```

Stop only this project's containers with `pnpm stack:stop`. Development database and upload named volumes persist. The test database uses tmpfs and loses its contents when its container stops. Avoid `docker compose down -v` unless intentionally deleting this project's development data.

Compose is a **local demo/development configuration**: credentials are public local-only values, ports bind loopback, and Swagger is enabled. The image defaults to production mode, which disables public Swagger. A production deployment still needs private credentials, a least-privilege runtime database role, a separate migration role, TLS, restricted networking, backups, and deployment-specific storage. No cloud deployment has been created.

## Commands

| Command                                      | Purpose                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                                   | Watch/restart the TypeScript API                                  |
| `pnpm build`                                 | Compile application into `dist/`                                  |
| `pnpm start:prod`                            | Run compiled API; configuration still comes from environment/.env |
| `pnpm lint`                                  | ESLint, including promise handling                                |
| `pnpm typecheck`                             | Check application, scripts, and tests                             |
| `pnpm format:check` / `pnpm format`          | Check/apply Prettier                                              |
| `pnpm test`                                  | Unit tests, no database                                           |
| `pnpm test:e2e`                              | HTTP infrastructure tests with fake database, no Docker required  |
| `pnpm db:test:up`                            | Start isolated PostgreSQL test service on 43105                   |
| `pnpm test:integration`                      | Real PostgreSQL/pgvector migration tests                          |
| `pnpm migration:run` / `pnpm migration:show` | Explicitly apply/list development migrations                      |
| `pnpm migration:run:prod`                    | Apply compiled migrations in release environment                  |
| `pnpm openapi:generate`                      | Write `docs/api/openapi.json` without database or API keys        |

To generate a migration after editing entities:

```powershell
pnpm migration:generate src/database/migrations/DescribeTheChange
```

Inspect generated SQL before running it. There is no automatic schema synchronization or startup migration. The initial migration enables `vector`; its rollback intentionally refuses automatic extension deletion because later columns could depend on it. No user or project seed exists until those entities are implemented.

The OpenAPI generator currently registers only health controllers in a metadata-only module. Add new controllers there as endpoints are implemented, and compare generated paths with the runtime document. Do not generate fake operations from the future endpoint inventory.

## Verify changes

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm db:test:up
pnpm test:integration
pnpm build
pnpm openapi:generate
```

Integration tests read `TEST_DATABASE_URL`, require a database name ending in `_test`, and reject the development URL. They apply migrations and verify pgvector plus idempotent replay. Never change that URL to shared or production data. Tests do not drop the database. HTTP tests use isolated temporary storage and a fake database; a passing HTTP suite alone is not real database verification.

The CI workflow repeats these checks, checks for OpenAPI drift, and builds the Docker image. It will run after the repository is pushed to GitHub; local verification does not mean remote CI has run.

## Structure

```text
src/
  config/                    # Validated environment
  common/                    # HTTP setup and error handling
  database/                  # TypeORM options, CLI data source, migrations
  modules/health/             # Only implemented feature module so far
  app.module.ts
  main.ts
  openapi.ts
scripts/                     # Offline OpenAPI and guarded integration runner
test/{unit,e2e,integration}/
docs/api/openapi.json             # Actual generated contract
.github/workflows/ci.yml
```

Do not put domain business logic in `common`. Add feature modules with their DTOs, services, entities, policies, and behavior tests as the guide's milestones progress.

## Production Deployment (Oracle Cloud Always Free)

Turnkey deployment configuration is located in the [`deploy/`](deploy/) directory for **Oracle Cloud Infrastructure (OCI) Always Free** (Ampere A1 ARM: 4 OCPU, 24 GB RAM, 200 GB NVMe - $0/month):

- **Automated Setup Script**: [`deploy/setup-oracle-vm.sh`](deploy/setup-oracle-vm.sh)
- **Deployment Guide**: [`deploy/DEPLOYMENT_GUIDE.md`](deploy/DEPLOYMENT_GUIDE.md)
- **Production Compose**: [`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml)
- **Caddy Reverse Proxy**: [`deploy/Caddyfile`](deploy/Caddyfile)

To deploy on a new Ubuntu Oracle Cloud VM:

```bash
curl -sSL https://raw.githubusercontent.com/mengchheanglong/AI-Workspace-backend/main/deploy/setup-oracle-vm.sh | bash
```

## Troubleshooting

- **Docker connection failure:** start Docker Desktop/the Docker engine, then rerun `pnpm db:up`.
- **Port already allocated:** inspect the owner; stop only this project's API if switching execution mode, or choose another local port. Do not terminate unrelated work.
- **Database connection refused:** confirm `pnpm db:up` passed and `.env` uses port 43104 for host execution; container execution uses hostname `postgres` and port 5432.
- **Invalid environment configuration:** the error identifies invalid fields without printing their values. Check exact `true`/`false`, valid URLs/ports, and keep Phase 2 flags false.
- **Migration permission denied:** extension setup needs an appropriate migration role; do not enable `synchronize` to bypass migrations.
- **Readiness 503:** check database availability and local storage permissions. Detailed credentials/paths are intentionally omitted from public responses.
- **PowerShell script execution restrictions:** use `pnpm.cmd` instead of `pnpm`; do not weaken machine-wide execution policy.

## Operational copilot and private memory

Workspace mode supports research, analysis, planning, and project work across
disciplines. In the frontend, new chats start in this mode; existing conversation
defaults and specialized modes are preserved. Learning assistance is available
when it helps the work or is requested.

Open **AI Copilot → Memory** to review, save, edit, or remove private context,
preferences, and lessons. **Remember…** on a completed reply opens a draft for
review; **Confirm and save** persists it. Memory is private to the authenticated
user in the selected project and separate from cited project evidence.

Apply the `1791072000000-CreateCopilotMemories` migration explicitly before
running this version against a persistent database (`pnpm migration:run`, or
`pnpm migration:run:prod` in the release environment). The change does not apply
migrations at startup. Memory CRUD needs neither AI credentials nor Redis;
generation still uses the configured provider.

MCP additionally exposes `list_copilot_memories`, `save_copilot_memory`,
`update_copilot_memory`, and `remove_copilot_memory`. Saves/edits require reviewed
text and `userConfirmed: true`; creates use a stable UUID `idempotencyKey` for
retries; edits/removals use the current version. Restart MCP clients after a
rebuild. Removed memories stop appearing in saved context; existing messages
are retained.

See [the reuse blueprint](docs/product/WORKSPACE_REUSE_BLUEPRINT.md) for the inspected
source revisions, memory responsibilities, and next runtime integration.
OpenClaw, Hermes, Paperclip, and Langflow are references/integration candidates;
this slice does not install or connect their runtimes.

## Reviewed AI actions through MCP

The stdio server exposes current workspace tools for projects, tasks, decisions,
documents, search, GitHub, activity, and reviewed AI proposals. It no longer
exposes meeting, requirement, or dashboard tools. Restart the MCP client after
rebuilding the backend to refresh tool discovery.

Generation creates a private, project-scoped task draft only. Inspect its source
decision and revision, edit using the current proposal version, then confirm only
reviewed item IDs with a stable `Idempotency-Key`; reuse that key for retries.
An empty `selectedItemIds` array creates no tasks. Unwanted drafts can be
rejected. All operations use the authenticated API, permissions, validation and
transaction checks.

Codex uses `.codex/config.toml` for project MCP settings. Forward the PAT with `env_vars = ["AI_WORKSPACE_API_KEY"]` and keep it in the local environment. CLI environment options belong before `-- node ...`; do not pass them as Node arguments. Restart the MCP client after rebuilding the backend to refresh its tool list.

Decision-based task drafts retain the source decision and revision. Review and
edit proposals before confirmation; a changed source decision requires
regenerating the proposal. INVALID_PROPOSAL_DRAFT, INVALID_SELECTION and
ASSIGNEE_NOT_MEMBER reject invalid writes. AI_RETRIEVAL_FAILED reports
unavailable context without creating a proposal or task.

GET /projects/:projectId/tasks/:taskId (and MCP `get_task`) returns aiProvenance
for confirmed AI-created tasks, including the source entity/revision and proposal
ID. Private draft text is omitted. Ordinary tasks return null provenance.

## Real data and provider configuration

Runtime pages and MCP tools use saved workspace records. The current workspace has two active users, Codex and Claude; the SRS and its saved feature-test records are retained. Mock LLM, embedding and GitHub providers are restricted to isolated tests. Unconfigured AI generation reports unavailable instead of returning simulated answers.

`AI_EMBEDDING_PROVIDER=disabled` is the default. In this mode ingestion preserves source text and indexes it for keyword search; hybrid retrieval uses keyword results. Explicit semantic search reports unavailable until a real embedding provider is configured. DeepSeek generation remains separate from embeddings.

To enable real semantic search, configure `AI_EMBEDDING_PROVIDER=openai` with a separate `OPENAI_API_KEY`, then reindex the project sources. Migration `1790985600000-RemoveMockEmbeddings` makes vectors nullable and clears only vectors labeled `mock-*`, retaining text, provenance and real vectors. Apply migrations explicitly; never reset a persistent database for this cleanup.

The legacy mock verification scripts (`verify-p2-01-ingestion.ts`, `verify-retrieval-chat.ts`, `verify-ai-task-flow.ts`) require a separate local `TEST_DATABASE_URL` targeting `ai_workspace_test` on port 43105. They ignore the application's `DATABASE_URL` so they cannot populate the live workspace with test data.

## Complete GitHub code indexing

Index Codebase checks every eligible source/document file, with no file-count cap. The frontend automatically follows `nextCursor` through short requests and shows checked-file progress. `POST /projects/:projectId/integrations/github/sync-code` accepts `connectionId`, an optional transient `accessToken`, `cursor` (default 0), `batchSize` (default 2, maximum 5), and `treeVersion` returned by the first batch. Continue until `nextCursor` is null; aggregate each batch's `indexedFilesCount` and `unchangedFilesCount`. A changed manifest rejects continuation and requires restarting from zero.

Successful GitHub SHA checkpoints and an indexed knowledge source allow unchanged files to be skipped. Interrupted or failed files are retried on the next run; partial coverage returns an error instead of success. Truncated recursive GitHub trees are expanded using nonrecursive tree requests. Generated/dependency files, lockfiles, unsupported formats and files over 100 KB remain excluded. An optional GitHub token can be entered for a synchronization/indexing run; it is cleared afterward and is not stored by the integration.

## Private folder uploads

Documents offers one browser folder upload flow. Legacy live/snapshot APIs and
stored data remain compatible; their duplicate panels are removed from the page.
Original files and relative paths stay in private backend storage. Files can be
downloaded immediately; only completed folder copies enter Hermes discovery.
Copilot retrieval becomes available as background extraction finishes.

Uploads persist per-file progress across page reloads and backend restarts. Use
**Resume**, reselect the unchanged source folder, and the browser verifies saved
files in 8 MiB blocks before skipping them. Changed saved files are rejected;
discard the copy and upload a new one to replace contents. Resume works at file
boundaries: an interrupted file restarts, while committed files are retained.
**Pause** stops requests and leaves a resumable copy. Copies are not live sync.

The original storage quota is per account across projects, enforced under an
account lock so concurrent uploads cannot exceed it. Configure in `.env`:

| Setting                      | Default                 |
| ---------------------------- | ----------------------- |
| `FOLDER_STORAGE_QUOTA_BYTES` | 20 GiB of originals     |
| `FOLDER_MAX_FILE_BYTES`      | 1 GiB per file          |
| `FOLDER_MAX_FILES`           | 100,000 per folder      |
| `FOLDER_MAX_SOURCES`         | 100 per project/account |

There is no separate 2 GiB folder cap. HTTP transport is bounded to 8 GiB per
request; validated configuration cannot exceed it. Quota counts original bytes,
not PostgreSQL search data or extracted derivatives. Back up PostgreSQL and
`STORAGE_LOCAL_ROOT` together and provide extra disk space for temporary uploads
and extracted content. Settings/usage are exposed privately under the project
upload settings route; no credentials or machine configuration are tracked.

The worker uses PostgreSQL leases rather than Redis, processes only active
owners/members on completed folders, and retries interrupted jobs after lease
expiry. Content preparation does not delay upload completion. UTF-8, PDF and
DOCX extraction stays bounded to 10 MiB originals / 4 MiB text. Unsupported files
remain downloadable. Larger UTF-8 originals can be read by Hermes in bounded
8,000-character pages without whole-file indexing. Each read scans at most
64 MiB; query offsets are capped. Large PDF/DOCX files remain metadata-only.

Run migrations explicitly against the isolated develop DB before testing.
The normal browser flow needs no PowerShell. Development UI/API use matching
`127.0.0.1` hosts (43100/43101) to avoid another app's IPv6 localhost listener.
Hosting, TLS and cloud object storage are not provisioned. Cross-device access
still needs a reachable authenticated backend and persistent storage. Hard
crashes may leave orphan/temp blobs; automatic blob reconciliation is future
work. Extraction is eventually consistent, not a guarantee that every format
can be understood by AI.

## Unified Copilot

Copilot now uses one general assistant and one conversation surface. Select
**Use tools** in the composer to run Hermes inside a project conversation.
Progress and reports remain in that thread; ordinary follow-up questions can use
the saved report. Reviewed proposals still require explicit product confirmation.
Apply the new migration before starting the updated backend. See
[Unified Copilot](docs/architecture/UNIFIED_COPILOT.md) for persistence, privacy, legacy API
compatibility, context bounds and verification.

Standalone chats retain their all-project context in conversation metadata. Apply
`ConversationWorkspaceScope1792368000001` with the explicit migration command
before starting this backend revision. The private chat remains in its existing
storage project; broader context means permitted project knowledge, not broader
access to another user's private conversation or memory.

See [Phase 1–3 implementation and compatibility](docs/product/OSCAR_MAVIS_PHASES_1_3.md) for goals, MAVIS review, platform setup, and module naming.
