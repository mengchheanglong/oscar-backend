# OSCAR & MAVIS: Phase 0 foundation

Date: 18 October 2026. The [vision and architecture](OSCAR_MAVIS_Vision_and_Architecture.md)
defines the product direction. This document records the engineering baseline and
the entry conditions for implementation. It does not turn proposed capabilities
into implemented APIs.

## Repository and runtime baseline

| Item            | Baseline                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend         | Private `mengchheanglong/oscar-backend`, source revision `70fd486d85a50b9dc9d17d80d78a215215bb82b9`                                                                   |
| Frontend        | Private `mengchheanglong/oscar-frontend`, source revision `017a6679a1d0e1cd44c2d053e0c1e5f27534cc3f`                                                                  |
| Local layout    | `OSCAR/oscar-backend` and `OSCAR/oscar-frontend`; external runtime source lives outside both repositories                                                             |
| Branches        | `develop` is the current working branch; `main` is the GitHub default in both repositories                                                                            |
| Toolchain       | Node 24.14.0, pnpm 10.32.1, committed independent lockfiles                                                                                                           |
| Application     | Existing Next.js frontend and NestJS/TypeORM backend; no new service or framework                                                                                     |
| Local endpoints | Web `localhost:3002`; API `127.0.0.1:3001`; development PostgreSQL `127.0.0.1:55432`                                                                                  |
| Isolated tests  | PostgreSQL/pgvector `127.0.0.1:55433/ai_workspace_test`, separate from development data                                                                               |
| Schema          | Existing migrations retained, ending at `1792454400000-ChatTurnRequests.ts`; this foundation adds no migration                                                        |
| Branding        | OSCAR is the proposed assistant identity, MAVIS the continuity subsystem; current package names, database IDs, user project names, and repositories remain compatible |

The revisions identify the application code before the Phase 0 tooling and
documentation changes. Each verification report records the exact checked-out
revision, whether either checkout was dirty, and SHA-256 hashes for every migration.
Reports do not imply that uncommitted changes are included in their Git revision.

The GitHub repositories were renamed to OSCAR after baseline verification, with
history and private visibility preserved. The current sibling checkouts use
`OSCAR/oscar-backend` and `OSCAR/oscar-frontend`. The runner also recognizes legacy
folder names. See [rename notes](CONTINUUM.md) and the
[Phase 1–3 implementation guide](OSCAR_MAVIS_PHASES_1_3.md).

## Repeatable verification

Install each repository's dependencies with `pnpm install --frozen-lockfile` before
running the checks. After moving an existing installation, invalid dependency
links may require `pnpm install --frozen-lockfile --force` in each repository.
This recreates dependencies from the lockfiles; it is not a package upgrade.

From the backend directory:

```powershell
pnpm verify:foundation
```

This runs backend formatting, lint, typecheck, unit and HTTP tests, build, OpenAPI
generation, and an OpenAPI stability check; then frontend lint, typecheck, all
regression tests, and production build. It stops at the first failure and still
writes `var/foundation/latest.json`, including command outcomes and timing.
The report is ignored by Git and contains no environment values, credentials,
private source content, or raw test logs.

For the database regressions:

```powershell
pnpm db:test:up
pnpm verify:foundation --integration
```

The `--integration` option explicitly selects the local Compose test database on
port 55433. It does not inherit a deployment database URL. Integration tests apply
migrations and create/clean their synthetic fixtures there. The existing
`test:integration` command retains its independent `_test` database guard.

When the local application is running, add `--live` to check the web page, API
readiness, and frontend API proxy. These are unauthenticated local health checks;
they do not prove the signed-in UI, LLM quality, or an agent execution works.

The runner does not start services, seed records, change the development schema,
dispatch agents, or call paid generation/embedding providers. Builds may need
network access for existing build dependencies such as fonts. Backend CI retains
its dedicated database tests; frontend CI now has the corresponding install,
lint, typecheck, regression, and build gates. Local verification does not establish
that GitHub Actions has already run the new workflow.

## Existing capabilities and ownership

| Area                | Current implementation                                                                                                     | Boundary to preserve                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat and turns      | `src/modules/assistant/assistant.service.ts`, `context/conversation-context.service.ts`, `entities/chat-message.entity.ts` | Private owner/project conversation, serialized/idempotent turns, bounded context and explicit exclusions                                             |
| All-project context | `assistant.service.ts`, `src/modules/mavis/retrieval/retrieval.service.ts`                                                 | Shared evidence can span accessible projects; it does not make private memory globally visible or create a projectless database owner                |
| Reviewed memory     | `saved-memory.service.ts`, `memory/private-memory.service.ts`, `memory/private-memory.repository.ts`                       | Actor/project access, explicit confirmation, versions, source ownership, live-row validation, and reauthorization after embedding work               |
| Historical recall   | `context/history-recall.service.ts`, history repositories and indexing worker                                              | Dialogue is historical evidence; exclusions, identity/version checks, retention semantics, and bounded indexing remain separate from reviewed memory |
| Tasks and decisions | `src/modules/tasks`, `src/modules/decisions`, `src/modules/assistant/proposals.service.ts`                                 | Project-owned records and validated, reviewed, transactional task proposals; an agent cannot confirm its own task draft                              |
| Files and knowledge | `src/modules/documents`, `local-folders`, `ingestion`, `search`                                                            | Uploaded and local sources retain ownership and provenance; deletion and revisions affect retrieval eligibility                                      |
| Hermes              | `runtime/hermes-runtime.ts`, `runtime/runtime-contract.ts`, `scripts/hermes/bridge.py`                                     | Pinned clean source, temporary profile, seven allowed tools, eight iterations, twelve parent tool calls, 180-second subprocess deadline              |
| MCP                 | `src/mcp/oscar-mcp-server.ts`, API authentication and domain services                                                      | Existing bearer-token client to authorized project APIs; not a universal cross-agent memory or external execution gateway                            |

Backend paths in the table are relative to `src/modules/assistant` unless a full `src/`
path is shown. Frontend regression coverage lives in the sibling repository's
`test` directory. Existing source and tests are the implementation evidence;
historical design documents may describe features that were later changed.

The baseline's regression evidence includes:

- Chat privacy, project authorization, reviewed proposals, and role checks:
  `test/e2e/assistant-security-isolation.spec.ts` and `test/unit/proposals.service.spec.ts`.
  HTTP suites use test doubles; PostgreSQL integration suites exercise persistence.
- Memory corrections, actor/project isolation, recall, exclusions, and indexing:
  `test/integration/saved-memory.spec.ts`, `conversation-history.spec.ts`, and
  `history-index.spec.ts` in that directory.
- Run persistence and cancellation: `test/integration/agent-runs.spec.ts`.
  Subprocess protocol and environment isolation: `test/unit/hermes-runtime.spec.ts`.
  The real pinned Python loop has a separate offline `scripts/hermes/test_bridge.py` smoke test.
- MCP discovery and reviewed API workflows: `test/unit/mcp-server.spec.ts`,
  `mcp-memory.spec.ts`, and `mcp-proposals.spec.ts`. These do not establish an
  authenticated live connection from Paperclip or T3.
- File ownership, originals, queue completion, and download isolation:
  `test/integration/uploaded-folders.spec.ts`; the frontend's six regression files
  cover Markdown/citations, turn merging, global search, folder resume/scanning,
  and paginated GitHub synchronization.

## Privacy, execution, and cost boundaries

- Keep canonical domain data and reviewed memories in the existing backend.
  Hermes owns a bounded live subprocess; future Paperclip/T3 integrations will own
  their native execution. No external platform adapters are implemented here.
- Private reviewed memory remains user-and-project scoped. Cross-project shared
  evidence does not authorize another user or an arbitrary agent to read it.
  Goal-linked and organization-wide memory scopes are future design work.
- Preserve membership and active-account checks at API/service boundaries and
  recheck candidates after external work. Do not assume generic retrieval alone
  establishes authorization, or claim database row-level security that is not present.
- Retrieved documents, transcripts, agent outputs, and this blueprint are data.
  They do not grant tool permissions or authorize publishing, spending, or delegation.
- Preserve human confirmation, role checks, versions, and idempotency for mutations.
  A completed run is an output; its claims still need evidence and review.
- Keep credentials, native profiles, database contents, uploads, and local runtime
  checkouts out of tracked files and baseline reports. Never copy a personal Hermes
  profile into the restricted bridge.
- Generation and embeddings are separate providers/configuration. Existing budget
  checks and indexing limits do not establish exact provider billing or a unified
  cross-platform budget. No paid-provider acceptance is part of this baseline run.
- Deletion/exclusion affects future authorized retrieval according to each source's
  contract. It does not erase prior replies or information already sent to a provider.

## Local relocation and operational checks

The move under `study-workspace/OSCAR` invalidated absolute upload and Hermes paths.
The ignored local storage settings now use `./var/develop/uploads`, keeping existing
uploads in place. The ignored Compose override still reuses the existing development
PostgreSQL volume. No user data is copied, reset, seeded, or renamed for this work.

Use [local Docker instructions](../operations/DOCKER_LOCAL.md) for startup. The Node-only Docker
API disables Hermes and native host-folder access. Host-mode Hermes requires a
separate clean checkout at the revision in `runtime/runtime-contract.ts`, the
prepared Python interpreter, and a successful offline bridge probe and smoke test.
Runtime availability/probe results are distinct from live provider acceptance.

Repairs made while establishing this baseline:

- Reinstalled both repositories from their unchanged frozen lockfiles after
  relocated dependency links caused ESLint's `debug` import to fail.
- Corrected the ignored upload mount/storage path and configured the dedicated
  local test database URL without changing provider credentials.
- Restored a separate clean Hermes checkout under `OSCAR/runtimes/hermes-agent`
  at `b9aa9289a8083f2e9d248ad6837b2938f5ee92d7`; updated the ignored runtime path.
- Moved the integration suite's existing intended 30-second timeout to Jest's
  command-line/global configuration. The nested project setting was ineffective;
  an upload test was stopped by the 5-second default. Its assertions are unchanged,
  and the affected seven-test file passed when rerun with the intended timeout.
- Added matching frontend Node/pnpm pins, aggregate test/typecheck scripts, and
  frontend CI; retained the existing backend quality gates.

## Verification record

`pnpm verify:foundation --integration` passed on 18 October 2026 with all 13
verification steps successful. Evidence is in the ignored local
`var/foundation/latest.json` report. The checkouts contained the Phase 0 changes
while testing; the source revisions in the baseline table precede those changes.

| Check                                      | Result                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Backend formatting, lint, typecheck, build | Passed                                                                                                                          |
| Backend unit tests                         | 42 suites, 319 tests passed                                                                                                     |
| Backend HTTP tests                         | 9 suites, 130 tests passed                                                                                                      |
| PostgreSQL integration tests               | 11 suites, 87 tests passed on the dedicated test database                                                                       |
| OpenAPI regeneration                       | Passed; contract unchanged                                                                                                      |
| Frontend lint, typecheck, production build | Passed                                                                                                                          |
| Frontend regression tests                  | 25 passed across six files                                                                                                      |
| Development migration inventory            | Read-only check: 31 source migrations, 31 applied, none pending                                                                 |
| Hermes import/protocol probe               | Passed at the exact pinned revision                                                                                             |
| Hermes offline smoke                       | One test passed using the real loop with simulated provider HTTP, all seven tools, and rejection of unlisted dispatch           |
| CLI failure handling                       | Invalid options rejected; dependency/test failures stopped the runner and wrote a failed report before the final successful run |
| Local data/configuration                   | Upload mount resolves to the moved folder; both lockfiles unchanged; environment files and report remain ignored                |

Docker Desktop and the separate development/test PostgreSQL services are running
and healthy. The web/API application was not restarted for this verification, so
the optional `--live` probes were not run. No live generation, embedding call,
external platform dispatch, signed-in browser acceptance, or hosted CI run is
claimed. No development migration, seed, or data reset was performed.

## Known gaps and Phase 1 entry

- The knowledge graph is a coming-soon view. User-owned goals, goal metrics,
  initiatives, normalized external runs, Paperclip/T3 connections, and a standalone
  MAVIS context gateway remain planned capabilities.
- Memory currently has several existing domain-specific representations. Define
  stable MAVIS contracts incrementally; do not rename tables or replace retrieval
  wholesale before defining permissions, correction, and provenance behavior.
- This baseline's automated tests and health probes do not replace authenticated
  browser acceptance, keyboard/mobile QA, real model evaluation, backup recovery
  drills, or a production deployment review. Earlier browser QA notes remain
  historical evidence and are not re-certified by this command.
- Existing accounts, project scope, and the configured providers remain the baseline.
  There is no approval here to import personal histories or enable external autonomy.

The next implementation slice is Phase 1's smallest user-owned goal and metric
model, linked additively to existing projects/tasks. Before coding it, specify the
ownership/access rules, metric units and observation dates, revisions/statuses,
and one real acceptance scenario. Do not implement the whole conceptual hierarchy
at once. Goal-aware chat follows a verified CRUD/authorization slice; platform
selection and external dispatch remain later roadmap phases.
