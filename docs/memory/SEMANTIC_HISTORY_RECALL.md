# Hybrid private-history retrieval

Normal Copilot chat combines PostgreSQL full-text candidates with exact pgvector
cosine search. `HistoryRecallService` owns ranking and provider work;
`HistoryVectorRepository` owns vector persistence and filtered search. It uses the
existing separate embedding adapter, leaving DeepSeek generation unchanged.

## Storage and identity

Migration `1792108800001-HistoryVectors` explicitly requires pgvector and creates a
`vector(1536)` column. Missing extension support fails clearly. A message/conversation
foreign key and composite conversation/project/user reference enforce ownership.
An identity includes the configured embedding endpoint, model, dimensions and
`history-head-900-v1` format. Its source excerpt and SHA-256 fingerprint are stored
with each vector; source equality is checked on activation and retrieval. The head
is the same first 900 PostgreSQL characters shown in the historical prompt excerpt.
Keyword search may match text beyond this head, but the returned excerpt still
contains only the head. Later facts need transcript context or passage indexing;
this version does not embed or expose every passage of a long message.

Different model/endpoint/input-format identities never share a vector comparison.
Changing the model creates a new identity; run bounded indexing batches until
`remaining=false`. Old rows remain available for rollback to the old configuration,
but are ignored by the new model. They are not silently relabelled or compared.
Changing dimensions requires a new migration and compatible code, not an env edit.

There is no approximate vector index. The B-tree scope index narrows metadata,
while distance ordering is exact. Consider HNSW only after representative tenant
and scope benchmarks establish a need and measure filtered recall/counts.

## Selection and privacy

Both retrievers enforce the same live conversation, owning actor/project, active
account/membership, completed role, exclusion and compaction-boundary predicates.
Each yields at most 32 candidates. Reciprocal-rank fusion deduplicates them; current
source data is revalidated after external embedding work. The existing six-result
and serialized byte budget remain in force, including All Workspaces requests.

`AI_HISTORY_MAX_COSINE_DISTANCE` defaults to 0.65 and accepts 0–2. This is an initial
calibration for the configured model on small synthetic examples, not a universal
confidence score. Re-evaluate it when changing models or data. The Thai examples
in the current evaluation still miss at this setting. Raising the threshold just
to pass those examples risks admitting irrelevant context.

If no compatible eligible vectors exist, no query embedding call is made. A provider
error or invalid vector permits keyword recall; database errors are propagated.
Private saved-memory and history retrieval can each make a query embedding call
when both stores contain compatible vectors; this version has no shared query cache.

Index activation uses the same scoped database row lock as privacy changes.
Exclusions/deletions remove affected derived vectors in their invalidation
transaction. An embedding result returned after exclusion cannot reactivate that
source. Normal chat still uses the history revision to reject stale reply commits.
Original transcript and reviewed-memory privacy semantics remain as documented in
[history exclusions](CONVERSATION_HISTORY_RECALL.md).

Retrieved excerpts also carry canonical saved-message sequence numbers. Relevance
ranking does not imply chronology; normal chat presents selected excerpts in saved
order and explains how later user statements can update a personal detail. This
metadata is read from canonical messages, so no vector re-index or migration is
required. See the [English answer evaluation](../evaluation/HISTORY_ANSWER_EVALUATION.md).

## Configuration and explicit indexing

The existing legacy `openai` adapter setting supports OpenAI-compatible embeddings.
For this local installation, the user authorized copying Continuity's OpenRouter
credential into the ignored backend environment. Only these settings were changed:

```dotenv
AI_EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=<credential stored only in ignored .env>
OPENAI_EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
AI_EMBEDDING_MODEL=openai/text-embedding-3-small
AI_EMBEDDING_DIMENSIONS=1536
```

OpenRouter documents this model and dimension on its
[embedding endpoint](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request).
Its observed live response uses the upstream name `text-embedding-3-small`; the
adapter accepts that exact alias only for this exact model/endpoint. Other model
or endpoint mismatches still fail. Configured routing identity remains persisted.
DeepSeek credentials are never used for embeddings. Generation and database
configuration were preserved. Shared embedding settings also apply to the existing
document and saved-memory adapter paths; their normal workflows are unchanged.

Apply the migration explicitly before restarting the backend. Indexing is an
operator action, not a chat/startup/CRUD backfill:

```powershell
pnpm exec ts-node scripts/index-conversation-history.ts <project-uuid> <user-uuid> --confirm-provider-cost
```

One invocation requests at most 32 eligible head excerpts. `attempted` counts
requested texts, not guaranteed activations; concurrent source changes may reject
activation. `remaining` reports more eligible rows needing the configured identity.
Repeat deliberately when using the operator path. Alternatively, enable the
optional [automatic indexing worker](AUTOMATIC_HISTORY_INDEXING.md), which adds
persistent daily input allowances and bounded retries. Without that worker, new
messages require another explicit indexing batch; keyword search remains available.
The operator command is outside the automatic worker's usage ledger.

## Evaluation

Use the dedicated `_test` database, distinct from `DATABASE_URL`, after its explicit
migration checks. The harness creates only synthetic users/projects and removes
their records in `finally`; it never copies development chats into test fixtures.

```powershell
pnpm exec ts-node scripts/evaluate-history-recall.ts --synthetic
pnpm exec ts-node scripts/evaluate-history-recall.ts --live --confirm-provider-cost
pnpm exec ts-node scripts/evaluate-history-recall.ts --live --confirm-provider-cost --holdout
```

Set `TEST_DATABASE_URL` separately. Each live run caps embedding calls at 20,
texts at 96, and total input characters at 45,000. It reports provider token usage
when returned, request/input counts and measured retrieval latency. It does not
infer currency cost. The synthetic mode uses oracle vectors and only verifies
mechanics; it cannot establish embedding quality. No generation calls are made.

See [measured evaluation](../evaluation/HISTORY_RECALL_EVALUATION.md) for the calibration and
held-out results, remaining misses and practical limits. The guide records actual
regression checks, local migration/indexing and activation status.
