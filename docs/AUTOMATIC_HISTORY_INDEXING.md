# Automatic private history indexing

The optional NestJS worker keeps normal Copilot history recall current without
requiring an operator command after each conversation. It uses the existing
PostgreSQL database and embedding adapter. DeepSeek generation is unchanged.
There is no second memory server or dependency on Continuity being running.

Apply `HistoryIndexing1792195200000` explicitly before enabling the worker.
It adds durable attempt/lease records and daily usage reservations; the existing
history vector migration still requires pgvector and `vector(1536)`. No vector
index or approximate search is introduced.

## Enablement and limits

The checked-in environment example keeps this disabled. Set these in the ignored
runtime environment only after configuring the separate embedding provider:

```dotenv
AI_HISTORY_AUTO_INDEX_ENABLED=true
AI_HISTORY_INDEX_DAILY_TEXTS=256
AI_HISTORY_INDEX_DAILY_BYTES=512000
AI_HISTORY_INDEX_SCOPE_DAILY_TEXTS=64
AI_HISTORY_INDEX_SCOPE_DAILY_BYTES=128000
```

`AI_ENABLED=true`, the existing `openai` compatible adapter, a separate embedding
key and 1536 dimensions are required. The current local embedding route is
OpenRouter's normal `openai/text-embedding-3-small` endpoint. There is no `:batch`
suffix or delayed batch job in this path. API keys themselves do not select batch
versus normal requests. No generation model change is needed.

Every 15 seconds, each enabled application replica can claim **one batch of at
most eight messages belonging to one user/project**. The first tick happens after
startup, and an instance never overlaps its own ticks. When idle, it does no
provider work. New messages are discovered from committed canonical rows; failed
requests cannot lose a separate enqueue operation. Older eligible messages and a
new embedding-model identity can also be processed within the same daily limits.
This is gradual catch-up, not an unbounded startup backfill.

Before a provider request, a short PostgreSQL transaction reserves both a global
and a user/project allowance under a shared advisory transaction lock. All
replicas use the same UTC-day ledger. Input is counted in UTF-8 bytes and texts;
**these are workload caps, not token counts or a USD billing guarantee**. Each
request contains at least one text, so request count is also bounded by the text
allowance. An individual message contributes at most its first 900 characters.
Failed requests, crashes and skipped sources keep their reservations; no refund
can accidentally permit overspending. The next UTC day starts a new allowance.
Changing the embedding model does not reset the day's allowance. Zero pauses
the corresponding allowance. Lowering a limit below reserved use pauses work.

The limits cover this automatic worker only. Semantic query embeddings, document
ingestion, reviewed-memory indexing, generation and the explicitly cost-confirmed
manual history indexing command remain outside this ledger. Generation's existing
USD project setting does not meter this worker. Exhausting an indexing allowance
leaves keyword recall and existing semantic vectors available; later messages
wait until allowance is available. This baseline is suitable for the small local
installation, not a validated large-tenant throughput or fairness guarantee.

## Retries, privacy and lifecycle

Claims have a two-minute lease. Errors wait one minute after the first attempt
and five after the second; the third attempt is final for that source fingerprint
and embedding identity. Process death leaves a recoverable lease unless its third
attempt was already reserved. A new process can reclaim an expired lease, and
lease IDs fence stale completion updates. This is at-least-once processing:
requests lost during crashes may be repeated and are charged again against limits.
Exhausted attempts require deliberate operator recovery, such as the existing
bounded manual indexing command; they do not silently retry forever.

The worker discovers ownership from canonical conversation records. Discovery
checks active accounts and membership, private user/project ownership, completed
message status, role, deletion and exclusion. It revalidates exact source content
before sending text, and access after provider work. Vector activation rechecks
the source and uses the existing exclusion lock. An exclusion or deletion while
a request is in flight cannot reactivate its source. As with other external model
requests, an exclusion cannot recall text already sent to the provider.

Successful vectors retain the configured model/endpoint/input-format identity.
An incompatible model is indexed separately; recall never compares identities.
Jobs store IDs, fingerprints, attempts and timestamps, not message text or keys.
Jobs cascade on physical message deletion. Operational usage rows retain daily
counts and scoped IDs; soft-deleting a chat does not erase its usage reservations.
Logs contain only fixed events and batch counts. Shutdown stops polling and
waits for the current request/activation work to finish. Disabling the flag and
restarting stops automatic spending without deleting existing vectors.

## Verification

`test/integration/history-index.spec.ts` exercises real PostgreSQL claims across
replicas, persistent leases, UTF-8 limits, shared daily quotas, model changes,
backoff/exhaustion, source changes, access revocation and exclusion races. Scripted
embeddings isolate these checks from provider billing. Worker lifecycle tests
cover disabled mode, overlapping ticks, shutdown and malformed provider output.
See the implementation guide's latest ledger for actual test and local activation
results; these tests do not measure production retrieval quality.

Local acceptance on 2026-10-16 passed: the running application's timer indexed
two sequential synthetic messages in 17,234 ms and 15,170 ms without a manual
indexing command. Both vectors had 1536 dimensions; the scoped ledger reserved
two requests, two texts and 98 UTF-8 input bytes. Fixtures were removed and
original counts restored. Backend and frontend proxy readiness returned 200.
All 567 automated tests plus lint, type checking, build and formatting passed.
This verifies automatic indexing locally, not generated-answer accuracy or
production readiness.
