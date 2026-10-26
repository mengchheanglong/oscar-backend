# Main OSCAR local embeddings

The main app supports pinned `qwen3-embedding:0.6b` through an existing local
Ollama runtime. Documents, private saved-memory recall, and conversation-history
recall use the same provider. This is separate from answer generation and from
the independent Knowledge service's configuration. No model is downloaded at
startup, and local failures never contact a paid embedding endpoint.

## Configure and migrate

Back up the existing local database and private `.env` first. Apply migrations
explicitly with `pnpm migration:run`. Migration `1793012400000` adds separate
1024-dimensional document columns; existing document text, index revisions,
provenance, and legacy OpenAI columns remain intact. Memory/history tables retain
their identity-keyed rows and accept both 1024 and 1536 dimensions. Reverting this
migration is intentionally refused; configuration rollback preserves both indexes.

Set a pinned digest from the installed runtime's `/api/tags` in ignored `.env`:

```dotenv
AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
AI_OLLAMA_MODEL_REVISION=<installed-64-character-sha256-digest>
AI_OLLAMA_QUERY_TIMEOUT_MS=5000
AI_OLLAMA_DOCUMENT_TIMEOUT_MS=120000
```

Before cutover, keep the current OpenAI provider/model/dimensions configured and
run this explicit, resumable local operator command for an authorized user:

```powershell
pnpm exec ts-node scripts/reembed-local-qwen.ts --user-id <user-uuid>
```

The command requires loopback `43104/oscar` and completed migrations. It visits
only active projects where that user is an active member, restricts private
sources to their owner, and indexes eligible saved memories and nonexcluded
completed user/assistant history. It never creates memories or generates answers.
Document activation rechecks source version, content and membership. Completed
vectors skip subsequent runs; failures retain prior indexes. Scope and source
changes can require another explicit run. Counters describe attempted batches;
concurrent edits/exclusions can reduce active coverage.

After coverage and retrieval verification, select:

```dotenv
AI_EMBEDDING_PROVIDER=ollama
AI_EMBEDDING_MODEL=qwen3-embedding:0.6b
AI_EMBEDDING_DIMENSIONS=1024
```

Build and restart the backend. Existing history indexing limits and privacy
filters still apply. Warm the model before testing interactive query latency.
Queries use the fixed retrieval instruction; indexed document/memory text stays
raw. Identity includes the endpoint, exact model digest, dimensions, instruction
and format/context version. A changed digest refuses inference until deliberately
configured and re-embedded. Inputs use a bounded 4096-token context with
`truncate=false`; oversized sources fail rather than being silently shortened.

## Rollback and deployment

Restore the previous provider/model/dimensions and endpoint from the private
environment backup, then restart the backend. Do not remove the migration or
delete vectors. Preexisting OpenAI vectors remain available; content added or
changed while Qwen was selected needs OpenAI indexing if switching back.

For the local Docker app, Compose selects `http://host.docker.internal:11434`;
override `OSCAR_DOCKER_OLLAMA_BASE_URL` if needed. Its endpoint is part of identity,
so host and container inference identities deliberately differ. Re-embed for the
selected endpoint rather than silently treating them as interchangeable. A hosted
deployment needs its own reachable inference service; this laptop's loopback
endpoint is not a production dependency. The checked-in default remains disabled.

Only 0.6B/1024 is enabled in the main application. A 4B benchmark does not enable
4B ingestion or select a new production model. Sizes/quantizations, memory use,
latency and retrieval quality must be evaluated together before another cutover.
