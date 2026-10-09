# AI Project Workspace Backend

NestJS backend foundation for the two-phase AI Project Workspace. Start with [AGENTS.md](AGENTS.md) for coding instructions and [PROJECT_IMPLEMENTATION_GUIDE.md](PROJECT_IMPLEMENTATION_GUIDE.md) for the complete roadmap.

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
[Hermes runtime setup](docs/HERMES_RUNTIME.md); the Node-only Docker image does
not bundle Hermes. The current local environment is enabled and passed a real
DeepSeek V4 Pro workflow; production runtime packaging/deployment remains pending.

## Prerequisites

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

- API liveness: [http://localhost:3000/api/v1/health/live](http://localhost:3000/api/v1/health/live)
- API readiness: [http://localhost:3000/api/v1/health/ready](http://localhost:3000/api/v1/health/ready)
- Swagger UI (local development): [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- Runtime OpenAPI JSON: [http://localhost:3000/api/docs-json](http://localhost:3000/api/docs-json)

The project defaults to port **3000**. Host development PostgreSQL is on **55432**. Update `.env` deliberately if local ports change; Compose has explicit mappings and does not inherit all `.env` runtime values.

There is no root `/` page; use the routes above. A successful response is `{"data":{"status":"ok"}}`. Readiness checks PostgreSQL and a temporary write/delete probe under local upload storage; it returns a generic 503 if either is unavailable. The API currently requires the database at startup. After startup, database failure causes readiness to fail while liveness remains available.

## Run the containerized local stack

```powershell
pnpm stack:up
```

This builds the API image, starts PostgreSQL, runs migrations in a one-shot release container, then starts the API on port 3000. Do not run `pnpm dev` on the same port simultaneously. To switch to host development:

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
| `pnpm db:test:up`                            | Start isolated PostgreSQL test service on 55433                   |
| `pnpm test:integration`                      | Real PostgreSQL/pgvector migration tests                          |
| `pnpm migration:run` / `pnpm migration:show` | Explicitly apply/list development migrations                      |
| `pnpm migration:run:prod`                    | Apply compiled migrations in release environment                  |
| `pnpm openapi:generate`                      | Write `docs/openapi.json` without database or API keys            |

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
docs/openapi.json             # Actual generated contract
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
- **Database connection refused:** confirm `pnpm db:up` passed and `.env` uses port 55432 for host execution; container execution uses hostname `postgres` and port 5432.
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

See [the reuse blueprint](docs/WORKSPACE_REUSE_BLUEPRINT.md) for the inspected
source revisions, memory responsibilities, and next runtime integration.
OpenClaw, Hermes, Paperclip, and Langflow are references/integration candidates;
this slice does not install or connect their runtimes.

## Reviewed AI actions through MCP

The stdio server now exposes 36 tools, including `generate_task_proposal`, `generate_decision_task_proposal`, `generate_meeting_analysis`, `list_ai_proposals`, `get_ai_proposal`, `update_ai_proposal`, `confirm_ai_proposal`, and `reject_ai_proposal`.

Generation creates private, project-scoped drafts only. Inspect the proposal and its source revision, edit using its current version, and confirm only reviewed, user-authorized item IDs. Confirmation requires `userConfirmed: true` and a stable `idempotencyKey`; reuse that key for retries. An explicit empty `selectedItemIds` array saves no domain items (a meeting summary can still be selected separately). Unwanted drafts can be rejected. All operations use the existing authenticated API, permissions, validation and transaction checks.

Codex uses `.codex/config.toml` for project MCP settings. Forward the PAT with `env_vars = ["AI_WORKSPACE_API_KEY"]` and keep it in the local environment. CLI environment options belong before `-- node ...`; do not pass them as Node arguments. Restart the MCP client after rebuilding the backend to refresh its tool list.

Requirement task drafts include server-owned sourceReferences for retrieved project documents. Review document/revision/page sources before confirmation; edits cannot replace these references. A changed or removed supporting document causes STALE_PROPOSAL. INVALID_PROPOSAL_DRAFT, INVALID_SELECTION and ASSIGNEE_NOT_MEMBER reject invalid writes. AI_RETRIEVAL_FAILED reports unavailable document context without creating a proposal or task.

GET /projects/:projectId/tasks/:taskId (and MCP get_task) returns aiProvenance for confirmed AI-created tasks: source entity/revision, proposal ID and document references. Private draft text is omitted. Meeting-derived requirements and decisions expose sourceMeetingId, and their generated tasks retain that link. Ordinary tasks return null provenance.

## Real data and provider configuration

Runtime pages and MCP tools use saved workspace records. The current workspace has two active users, Codex and Claude; the SRS and its saved feature-test records are retained. Mock LLM, embedding and GitHub providers are restricted to isolated tests. Unconfigured AI generation reports unavailable instead of returning simulated answers.

`AI_EMBEDDING_PROVIDER=disabled` is the default. In this mode ingestion preserves source text and indexes it for keyword search; hybrid retrieval uses keyword results. Explicit semantic search reports unavailable until a real embedding provider is configured. DeepSeek generation remains separate from embeddings.

To enable real semantic search, configure `AI_EMBEDDING_PROVIDER=openai` with a separate `OPENAI_API_KEY`, then reindex the project sources. Migration `1790985600000-RemoveMockEmbeddings` makes vectors nullable and clears only vectors labeled `mock-*`, retaining text, provenance and real vectors. Apply migrations explicitly; never reset a persistent database for this cleanup.

The legacy mock verification scripts (`verify-p2-01-ingestion.ts`, `verify-p2-02-retrieval-chat.ts`, `verify-ai-task-flow.ts`) require a separate local `TEST_DATABASE_URL` targeting `ai_workspace_test` on port 55433. They ignore the application's `DATABASE_URL` so they cannot populate the live workspace with test data.

## Complete GitHub code indexing

Index Codebase checks every eligible source/document file, with no file-count cap. The frontend automatically follows `nextCursor` through short requests and shows checked-file progress. `POST /projects/:projectId/integrations/github/sync-code` accepts `connectionId`, an optional transient `accessToken`, `cursor` (default 0), `batchSize` (default 2, maximum 5), and `treeVersion` returned by the first batch. Continue until `nextCursor` is null; aggregate each batch's `indexedFilesCount` and `unchangedFilesCount`. A changed manifest rejects continuation and requires restarting from zero.

Successful GitHub SHA checkpoints and an indexed knowledge source allow unchanged files to be skipped. Interrupted or failed files are retried on the next run; partial coverage returns an error instead of success. Truncated recursive GitHub trees are expanded using nonrecursive tree requests. Generated/dependency files, lockfiles, unsupported formats and files over 100 KB remain excluded. An optional GitHub token can be entered for a synchronization/indexing run; it is cleared afterward and is not stored by the integration.
