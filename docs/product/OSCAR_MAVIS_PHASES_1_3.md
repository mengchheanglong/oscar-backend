# OSCAR & MAVIS: Phase 1–3 implementation

## Goals and strategic context

Goals are owned by a user and can optionally belong to a project. Project goals
require current membership; archived projects cannot be modified. Tasks and
decisions can link to a goal in the same project. A goal cannot move to another
scope after creation because its linked work retains that scope.

Measured progress uses outcome metrics first, completed milestones second, and
manual progress when neither exists. Task completion is reported separately: doing
all the tasks does not prove that a business outcome was achieved. Metrics record
their observation date. Goal revisions and optimistic versions preserve update
history and reject conflicting writes.

The Goals page supports creating and editing personal and project goals, initiative
status updates, metrics, milestones, linked
work, revision history, and strategic review. Starting a review passes the selected
goal to a new assistant turn. All-project chat searches approved memory across all
authorized project IDs in one bounded query, including the actor’s personal memory. Goal, memory, source, conversation-history, and runtime
context remain separate and bounded before inclusion in a model prompt.

## MAVIS memory lifecycle

Candidates may come from a manual note, an accepted decision, an owned chat
message, or the actor's successful runtime work. Captured sources are validated
before a candidate is written. Private runtime prompts are not copied into shared
project provenance. Approved memory is reviewed context, not executable authority.

A browser session with CSRF protection is required to approve, reject, or correct
memory. API tokens and MCP tools cannot approve their own candidates. MCP retains
candidate creation. Corrections atomically supersede the previous approved memory
and preserve provenance. Superseded memories cannot reactivate. Concurrent review
with the same version permits one winner.

Recall includes only approved, reviewed, currently valid memories in accessible
scopes. Personal memories remain private even when their ID is known. Goal memory
requires a live goal. Changed or deleted accepted decisions invalidate their old
memory for retrieval. Raw source evidence and past messages are not promoted into
approved memory. Semantic source retrieval lives in MAVIS, alongside its distinct
approved-memory retrieval pipeline.

## Read-only platform connections

Connections and credentials belong to the connecting account. Project assignment
does not share credentials. Tokens are masked in API responses and encrypted at
rest with AES-256-GCM. Set a private base64 32-byte `PLATFORM_CREDENTIAL_KEY` before
using connections; retain that key across restarts and backups. Existing plaintext
credentials are read compatibly and encrypted when subsequently saved.

`PLATFORM_ALLOWED_ORIGINS` is an exact origin allowlist. Loopback HTTP installations
are supported; remote installations require HTTPS. Redirects are rejected. Configure
`PLATFORM_OAUTH_CALLBACK_ORIGIN` when the API's public origin differs behind a proxy.
These phase 3 activity connections are read-only. The subsequent
[T3 chat handoff](OSCAR_T3_HANDOFF.md) adds separately authorized supervised work.

- Paperclip uses company-scoped REST endpoints and a Bearer token. Enter the
  installation origin, company ID, and token. Activity includes agents and issues.
- T3 uses its Streamable HTTP MCP endpoint and OAuth with PKCE. Save the connection,
  choose Authorize, and approve read-only orchestration access. OSCAR calls only
  `t3_project_list` and `t3_thread_list`. Expired/revoked authorization requires
  reconnection. Partial or incompatible snapshots produce warnings rather than
  fabricated zero activity.

Activity links are validated against the accessible upstream record before being
mapped to a local project or goal. Native upstream links remain available. The UI
supports connection editing, token replacement, OAuth authorization, activity,
status refresh, mappings, unlinking, and removal. Real installation credentials are
still required for deployment acceptance; local protocol fixtures do not prove a
particular live installation is reachable.

Protocol references:
[Paperclip API](https://github.com/paperclipai/paperclip/blob/master/docs/api/overview.md),
[T3 outside agents](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md).

## Names and compatibility

| Responsibility                           | Canonical source name                   |
| ---------------------------------------- | --------------------------------------- |
| Product and branding                     | OSCAR / OscarIcon / oscar-brand         |
| Chat, proposals, and agent runtime       | `modules/assistant`, `AssistantService` |
| Approved continuity and source retrieval | `modules/mavis`                         |
| Existing private saved notes             | `SavedMemory`, `saved-memory.*`         |
| Goals and metrics                        | `modules/goals`                         |
| Read-only integrations                   | `modules/platforms`                     |
| MCP server                               | `oscar-mcp-server.ts`, `OscarMcpServer` |

Existing `/ai` HTTP routes, persisted table/column names, historical migrations,
`aiw://` resource identifiers, legacy memory tool names, and browser storage keys
are retained for compatibility. The MCP CLI prefers `OSCAR_API_URL`, `OSCAR_API_KEY`,
and `OSCAR_PROJECT_ID` while accepting older `AI_WORKSPACE_*` variables. They are
compatibility boundaries, not competing module names. Historical product documents
remain historical records. New source imports use the canonical names above.

The backend build removes only its own `dist` directory before compiling. This
prevents renamed legacy entity/controller files from surviving in local builds.
Run committed migrations normally; do not rename or recreate historical tables.

## Verification

Run backend `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`,
and `pnpm openapi:generate`. Frontend checks are `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm build`. Database regressions use `pnpm test:integration`:
`TEST_DATABASE_URL` must identify a dedicated database ending in `_test`, distinct
from development. The runner creates a unique temporary database on that server,
applies migrations, runs tests, and drops only that generated database. Its account
needs CREATE DATABASE permission. Development data is never reset by this runner.

Regression coverage includes access boundaries, outcome progress, source capture,
review lifecycle and concurrency, stale/expired recall, real PostgreSQL queries,
credential encryption, company REST, and local OAuth/MCP protocol fixtures.
Browser acceptance uses synthetic data in another isolated test database, with
AI/provider access disabled. Live model quality and real Paperclip/T3 authorization
are separate deployment checks.
