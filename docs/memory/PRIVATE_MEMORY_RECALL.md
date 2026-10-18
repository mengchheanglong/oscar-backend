# Query-based private memory

Implemented 2026-10-14 as the first slice of the
[Continuity integration](../architecture/CONTINUITY_INTEGRATION_AUDIT.md).

Normal Copilot chat and Hermes Agent work now use the same private-memory
selector. It searches all eligible reviewed memories in the owning project,
rather than taking only the eight latest entries. The Memory panel still lists
the latest 100 for management; that listing limit does not limit recall.

## Behavior

- PostgreSQL English full-text search ranks matching terms. Optional exact
  pgvector cosine search adds compatible indexed candidates. Reciprocal rank
  fusion combines positions with stable ID tie-breaking.
- Queries are bounded to 2,000 characters; each search retrieves at most 32
  candidates. The injected result remains at most eight entries and 4,000
  serialized characters, including IDs, kinds, contents and versions.
- Private memory is restricted to the authenticated actor and conversation/run
  project. All Workspaces broadens shared evidence only. Active membership/account
  checks occur before external work and again before results; SQL also enforces
  those boundaries. This slice uses workspace service/query authorization, not
  a newly introduced RLS guarantee.
- Only reviewed canonical memory is searched. This adds no automatic saves,
  edits, forgetting, general chat-history search or new Hermes tools.
- Empty queries return no entries. Keyword misses do not fall back to unrelated
  recent memories. Semantic results are nearest candidates, not calibrated
  relevance probabilities; no claim of zero irrelevant recall is made. English
  lexical search has language limitations. Real-provider quality and multilingual
  retrieval still need evaluation.
- Compatible vectors must exist before a query embedding is requested. Missing
  embedding configuration or query-embedding failure uses keyword retrieval.
  Safe debug diagnostics identify mode and selected IDs/versions, never content.
  Database/schema failures are not caught as embedding fallback.

## Code ownership

`src/modules/ai/memory/` contains the scope/result contracts, provider factory,
SQL repository and selection/indexing service. Existing `CopilotMemoryService`
retains reviewed CRUD, source validation, optimistic versions and retry identity.
`AiService` and `AgentRunsService` delegate selection without duplicating ranking.
The configured workspace generation model and existing frontend API remain intact.

The shared OpenAI embedding adapter now validates response count, unique indices,
model identity when returned, finite/nonzero fixed-length vectors and safe errors.
It rejects redirects and uses a 30-second request timeout. These validations also
protect its existing ingestion callers.

## Migration and explicit indexing

Apply the following migrations explicitly in the intended environment before
starting this backend version:

- `1791936000000-PrivateMemoryRecall`: pgvector availability check, generated
  full-text column/GIN index and a derived `vector(1536)` table with composite
  actor/project/memory references and source-version metadata.
- `1791936000001-ReadableMemoryEmbeddingIdentity`: stores the canonical identity
  as readable provider namespace, model, dimensions and preprocessing revision.
  This follow-up preserves the first migration after its isolated test application.

There is no approximate vector index. A future dimension change requires a new
migration. No external vector service is supported. New deployment settings still
require verification of the hosting platform's pgvector support.

Keyword recall is available after migration without AI credentials or backfill.
For semantic recall, configure the existing separate OpenAI embedding settings
with 1,536 dimensions. A different dimension fails explicitly; the generation
provider key is never used for embeddings.

An operator may explicitly index one actor/project using:

```powershell
pnpm exec ts-node scripts/index-private-memory.ts <project-uuid> <user-uuid> --confirm-provider-cost
```

This command uses the configured database and embedding credentials, makes paid
provider requests, and indexes at most 32 pending entries per invocation. It does
not migrate the database or start the application. Review the target environment
and actor/project mapping before running it. The command is an operator tool,
not a model tool or public API. It was not run against real credentials during
implementation. It prints only attempted count and whether work remains; attempted
does not mean every row activated, because concurrent edits can invalidate work.

Repeat bounded batches when `remaining` is true. Each batch has a generation ID;
activation is per row with source-version/content and eligibility checks, not an
all-or-nothing global generation switch. Retries replace the same model/row entry
idempotently. Interrupted work leaves valid completed rows available. Old-model
rows remain stored, but queries only compare vectors with the current identity.
Changing the model requires explicit re-indexing; lexical recall stays usable.

Edits/deletions invalidate old indexed versions immediately in retrieval, before
cleanup. New/edited memories remain keyword-searchable until explicitly indexed.
No background paid backfill is introduced. Derived vectors are not copied from
Continuity. Canonical reviewed memories and original conversations are untouched.

Deleting a reviewed memory prevents its selection here, but does not erase past
replies. A reviewed copy still survives source-conversation deletion under the
existing product contract. Cross-chat history exclusion/compaction is later work.

## Validation and release limits

Tests use scripted embeddings and the dedicated PostgreSQL/pgvector test database
on port 55433. Coverage includes an old relevant entry beyond 100 newer entries,
actor/project isolation, membership revocation during external work, stale indexing,
edit/delete invalidation, model changes, composite scope constraints and invalid
vector dimensions. Existing chat and Hermes integration checks exercise the shared
selector. Provider HTTP responses are mocked; no paid inference or backfill ran.

The implementation guide records final test totals. These migrations have only
been applied to the isolated test database in this task. No development/production
database migration, running-server restart, public deployment or live browser
acceptance is claimed. Rollout requires the explicit migration step above.
