# Continuity integration audit

Date: 2026-10-14. Status: code audit and implementation specification; integration
has not been implemented. AI Workspace remains the product and canonical database.
Continuity remains a runnable reference until individual capabilities are ported
and verified. No runtime upgrade or provider replacement is part of this plan.

## Evidence and limits

Inspected backend `develop` at `9e30baf007710a0a1ac7ad837b6a787ebe10c157`
and frontend at `51e56b9745eaa1f5e246e16522e757be0b62cf5d`; both were clean
before this audit. Continuity source was inspected at
`C:/Users/User/study-workspace/continuity`; no Git revision is available for it.
This is a focused inspection of memory, retrieval, context, provider boundaries,
runtime integration and associated tests, not a full security audit.

The [reuse blueprint](WORKSPACE_REUSE_BLUEPRINT.md) establishes product ownership.
The [runtime guide](HERMES_RUNTIME.md) explains the existing direct Hermes bridge.
Current source, rather than historical completion claims, informs the findings
below. No real environment files, credentials, transcripts or database records
were read. No live inference, migration, deployment or data transfer was performed.
No AIW decision tools are exposed in this session; accepted decisions were not
consulted and no project task status was changed. Frontend inspection was read-only.

## Findings that change the migration plan

| Area                | Code observed in AI Workspace                                                                                                                                                                                            | Integration consequence                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project evidence    | `retrieval/retrieval.service.ts` already implements exact cosine search, model-name filtering, PostgreSQL full-text search and reciprocal rank fusion. Ingestion activates new index versions transactionally.           | Keep it. Private memory requires its own eligible dataset; do not duplicate shared evidence retrieval or add private memories to shared chunks.          |
| Private memory      | `copilot-memory.service.ts` checks active account/membership, actor/project scope, confirmation, source-message ownership, retry identity and optimistic versions. It lists at most 100 entries, ordered by update time. | Keep canonical CRUD and its contracts. Search must query all eligible memories with bounded candidate limits, not search only the first 100 listed rows. |
| Memory injection    | `ai.service.ts` and `agent-runs.service.ts` each request eight recent memories. `context-assembler.ts` limits serialized memory to 4,000 characters.                                                                     | Replace both selection calls with the same query-aware private-memory service. Preserve the current injection bound initially.                           |
| Normal chat history | `ai.service.ts` loads eleven latest messages, removes the just-created user message and sends up to ten prior messages. `Conversation` has no summary or compaction boundary.                                            | Port context preparation later, with explicit schema and concurrency semantics; this is more than changing a numeric limit.                              |
| Agent execution     | `runtime-contract.ts`, `hermes-runtime.ts`, `agent-runs.service.ts` and `scripts/hermes/bridge.py` implement the bounded subprocess/tool loop, cancellation and reviewed proposals.                                      | Reuse Hermes; do not build another loop in Continuity. The pinned runtime remains `b9aa9289a8083f2e9d248ad6837b2938f5ee92d7`.                            |
| Agent memory access | The bridge skips personal Hermes memory and permits seven named workspace tools. Private reviewed memory is initially injected, but there is no private-history search/read tool.                                        | Later add read-only recall tools to both the parent allowlist and bridge contract, with scope supplied by the server.                                    |
| Frontend            | `copilot-memory-panel.tsx` submits explicit confirmation and versions; `assistant/page.tsx` uses the saved conversation's project for memory in All Workspaces.                                                          | Keep this UI and authorization meaning. The first retrieval slice needs no new frontend or bulk import.                                                  |
| Context overhead    | `ContextAssembler` embeds evidence in `systemPrompt`; `AgentRunsService` appends `evidenceText` again.                                                                                                                   | Remove duplicated evidence in the later context slice and test that each source appears once.                                                            |

## Reuse map

Continuity paths below are relative to its root. Destination paths are proposed
unless explicitly described as existing. Port behavior into the workspace's
NestJS/TypeORM/CommonJS toolchain; do not import Continuity's ESM application.

| Continuity source                                                                            | Decision                                     | AI Workspace destination / adaptation                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/memory/ranking.ts`                                                             | Adapt pure algorithms                        | `src/modules/ai/memory/ranking.ts`; use explicit memory IDs and typed results. Existing shared evidence RRF remains in place. Conversation diversity belongs to the later history slice.                                             |
| `src/features/memory/precision.ts`                                                           | Reuse test scenarios; defer thresholds       | Exact identifier preservation is useful. Similarity cutoffs 0.35/0.7 were not calibrated for this workspace's embeddings and must not become untested defaults.                                                                      |
| `src/features/memory/retrieval.ts`, `archive.ts`                                             | Rewrite persistence boundary                 | `memory/private-memory.repository.ts` and `memory/private-memory-retrieval.service.ts`; UUID actor/project scope, active membership/account, live reviewed rows and matching index versions. No free-text `personal` scope.          |
| `src/features/history/index-service.ts`                                                      | Adapt stale-write protection                 | `memory/private-memory-index.service.ts`; bounded batches, version/content checks, model identity and reauthorization before activation. Embedding work remains outside long DB transactions.                                        |
| `src/features/chat/context.ts`, `context-policy.ts`                                          | Adapt in slice 2                             | Existing `context/` directory: provider-neutral budget policy, whole-turn preservation, bounded summaries, failure atomicity and diagnostics. Keep workspace prompt/citation and memory rules.                                       |
| `src/providers/context-limits.ts`                                                            | Keep provider-specific implementation behind | Its OpenAI/OpenRouter model metadata cannot establish DeepSeek limits. Verify the workspace model's limits and estimation method before selecting budgets. Do not inherit 128k or the OpenAI tokenizer as authoritative.             |
| `src/features/chat/recall.ts`                                                                | Decompose, do not copy                       | Retrieval orchestration can inform workspace services. Automatic extraction/upsert/forget behavior conflicts with reviewed memory and is excluded. Query planning is optional future work with explicit usage accounting.            |
| `src/features/memory/evidence.ts`, history dependency/exclusion code                         | Adapt in later history slice                 | Reauthorize every traversal edge and source. Workspace reviewed memory is an independent saved copy and may survive deletion of its source conversation; derived summaries/history must respect their own exclusions.                |
| `src/shared/personalization.ts`, personalization repository                                  | Defer separate settings                      | Existing reviewed `PREFERENCE` entries can supply initial personalization. Structured response preferences may follow without adding cross-project private memory.                                                                   |
| `test/large-context.test.ts`, `precision.test.ts`, `long-memory.test.ts`, `evidence.test.ts` | Port scenarios                               | Workspace Jest unit tests and dedicated PostgreSQL integration fixtures. Preserve scope, correction, deletion, model mismatch, stale indexing and compaction-failure cases. Synthetic recall scores do not prove live model quality. |
| Node HTTP server, Better Auth, frontend, workspace composition, jobs and batch adapters      | Leave in Continuity                          | Existing workspace auth, NestJS API, frontend, Hermes lifecycle and configured provider remain authoritative. No second API, auth database or OpenRouter batch dependency.                                                           |
| Continuity SQL migrations and existing records                                               | Do not apply/copy                            | Add new TypeORM migrations for workspace entities. Any eventual data import needs explicit account/project mapping, reviewed content and a dry-run; no implicit ID matching.                                                         |

## Contracts that must be resolved explicitly

### Authorization and privacy

Continuity uses owner-bound text identifiers plus transaction-local forced RLS.
AI Workspace uses UUID users/projects, membership/action guards and service
checks. Its reviewed-memory migration does not install Continuity's RLS policy.
Do not claim an RLS guarantee from porting the ranking algorithm.

Every new private recall query must bind actor and owning project, check active
membership/account, and exclude deleted rows. The authenticated server supplies
these IDs; model arguments cannot select an actor or broaden project access.
All Workspaces changes shared evidence scope only. Recheck access after external
embedding work, before returning context and before activating index results.
Use composite scope constraints for new derived tables. Any RLS addition needs
an explicit transaction/connection-context and non-bypass-role design, rather
than copying Continuity policies into unrelated workspace tables.

The existing shared `RetrievalService` accepts a list of project IDs prepared by
callers; its shared-source SQL does not independently authorize every supplied
project ID. This is not evidence of a demonstrated endpoint exploit, but means
the new private service must not treat this generic retriever as its authorization
boundary or call it with model-supplied scope.

### Embeddings and database lifecycle

Continuity's columns use `vector(256)`; the workspace's knowledge migration uses
`vector(1536)`. The workspace embedding provider defaults to
`text-embedding-3-small` with 1,536 dimensions. Preserve the workspace embedding
configuration and validate it against the new column; never pad, truncate, or
reuse Continuity vectors as workspace vectors.

The inspected workspace embedding adapter currently casts response JSON and
collects indexed vectors without complete runtime validation. The integration
must validate response cardinality, unique/in-range indices, finite numbers,
nonzero vectors and exact dimensions before storing or comparing vectors.
Its current error path includes provider response text; new indexing errors
must use safe error codes rather than propagate private provider payloads.

For private memory, use a separate derived index table with actor/project/memory
identity, source version, content hash, embedding identity and generation ID.
Identity includes provider namespace, model, dimensions and preprocessing
revision. Exact model identity is a predicate of every semantic query, even if
two models have equal dimensions. Full-text search reads current reviewed rows.

Re-index into a new generation, then activate only validated results whose
source version/content and authorization still match. Keep lexical recall usable
while rebuilding. A model switch must never compare old-model vectors with a
new-model query. A dimension change requires a versioned schema migration/new
dimension-specific storage, not a runtime cast. Do not delete the only working
generation before a replacement has passed verification.

Additive migrations must assert pgvector availability with a clear failure,
create fixed-dimension columns and identity/version constraints, and add full-text
and scope indexes. No HNSW/IVFFlat in the initial slice. Verify any future ANN
index against exact results under real actor/project/deletion filters. Missing
pgvector is a database setup error, not an invitation to use another vector
service. No hosting configuration is selected by this audit; verify the intended
platform's extension support before deployment settings are chosen.

### Meaning of deletion and review

Keep `userConfirmed`, optimistic versions, idempotency keys and source ownership
checks in `CopilotMemoryService`. Retrieval and indexers never create or revise
reviewed memory. Editing/removal must invalidate the previous derived version
immediately through query predicates, even before asynchronous cleanup runs.

A reviewed saved copy may survive source-chat deletion under the existing product
contract. Deleting memory removes it from future private-memory retrieval; it
does not erase past replies. Future history recall must separately prevent old
generated summaries/replies from reintroducing excluded memory as current profile
facts. Do not promise complete forgetting across history until this is implemented.

## First implementation slice: relevant reviewed memory

Observable outcome: an older reviewed preference or constraint relevant to the
request is available to both normal chat and Agent work, while unrelated recent
entries do not consume the whole memory allowance.

1. Introduce typed `PrivateMemoryScope`, retrieval results and embedding identity
   contracts under `src/modules/ai/memory/`, independent of HTTP/provider SDKs.
   Keep canonical reviewed CRUD in its existing service.
2. Add the derived index migration and a repository with shared eligibility
   predicates for lexical search, exact semantic search and stale-write checks.
   Bound query length/candidates/results; use parameterized SQL and stable ties.
3. Implement a bounded explicit backfill/index workflow. Validate provider outputs,
   index only eligible reviewed content and make retries version-safe. Memory CRUD
   must continue working without AI credentials. Do not hide a paid full backfill
   in application startup or the first chat request.
4. Fuse lexical and compatible semantic candidates, without unvalidated similarity
   thresholds or mandatory generative reranking. If embeddings are unavailable,
   use explicit keyword retrieval with honest internal diagnostics. A missing
   required database extension must fail, not silently degrade.
5. Replace `memoryService.list(..., 8)` / `memory.list(..., 8)` in normal chat and
   Agent work with this service using the current message/run prompt. Keep the
   eight-item/4,000-character injection limit for this slice and account for JSON
   overhead. An unrelated recent item is not a relevant search match.
6. Keep the existing Memory panel API unchanged. Add safe diagnostics for selected
   IDs/versions and retrieval mode without logging memory content. Later UI
   diagnostics require a deliberate API contract and OpenAPI update.

Acceptance gates:

- An old relevant entry outside the latest 100 rows can be recalled; an empty or
  unrelated query does not manufacture a match. Exact identifiers remain useful.
- Two users sharing a project cannot retrieve each other's private memories;
  two projects owned by one user remain isolated, including All Workspaces.
- Removed memberships/inactive accounts are rejected before and after delayed
  embedding work. Both chat and Hermes use the same scope and bounded result set.
- A stale embedding response after edit/delete cannot activate or return the old
  entry. Duplicate indexing attempts do not create duplicate active results.
- Wrong model, wrong dimension, NaN/infinite/zero vectors, missing/duplicate result
  indices and malformed provider responses cannot enter the active vector index.
- Model changes and interrupted re-indexing preserve current lexical eligibility;
  semantic comparisons never mix identities. Real PostgreSQL validates constraints,
  pgvector behavior and exact query results using synthetic fixtures.
- Missing credentials do not break reviewed CRUD. Keyword-only retrieval is
  distinguishable from semantic success. No private memory becomes project evidence
  or grants tool authority; existing reviewed saves continue to work.

Subsequent slices, in order: provider-aware normal-chat context and durable summary
boundaries; owner/project-bound conversation search/read tools for Hermes; history
dependency invalidation; reviewed outcome-to-lesson workflows. Rich procedural
registries or independent memory services wait for actual product requirements.

## Verification and rollout

This audit changes documentation only. Focused offline unit checks are recorded
in the implementation guide's audit ledger; they do not establish live provider,
database or frontend acceptance. No migrations or application behavior changed.

For the implementation, run lint, typecheck, unit/e2e tests and build; start only
the dedicated test database on 55433 and run real PostgreSQL integration checks.
Do not reuse Continuity's test fixture on 55432: AI Workspace documents that port
for its development database. Keep runtime and migration roles explicit.
Run OpenAPI generation only if public contracts change and inspect the result.

Before release, benchmark the new private selector on representative synthetic
fixtures, verify no scope leakage, and compare to the recent-eight baseline.
Apply migrations explicitly in the intended environment after reviewing capacity.
Enable query-based selection only after tests and index readiness checks; retain
reviewed CRUD if indexing is unavailable. Do not drop canonical memories or the
Continuity application as rollback. Paid acceptance, hosting verification and any
actual legacy-data import remain separate, explicit work.
