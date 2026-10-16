# Bounded conversation continuity

Implemented 2026-10-15 for normal Copilot chat. This replaces the previous fixed
ten-message history selection. Hermes continues to use its separately bounded
runtime; this change does not install a second agent loop or modify its profile.

## Context policy

All eligible completed user/assistant messages after the saved summary boundary
are considered, in stable database sequence order, up to the current user request.
Failed/pending/system messages are excluded. The original transcript remains
stored. More than ten messages are retained whenever the context fits.

`AI_CONTEXT_INPUT_BUDGET` defaults to 128,000, configurable from 16,000 to 512,000.
These are **conservative estimated units based on UTF-8 bytes plus framing**, not
an exact tokenizer count and not a promise of 128,000 actual tokens. Ordinary
English will generally compact substantially earlier than a true 128k-token
window. This deliberately avoids treating an OpenAI tokenizer as DeepSeek's.
Provider-reported usage remains authoritative; calibrating a versioned DeepSeek
tokenizer is a future improvement.

DeepSeek currently documents a 1M context for `deepseek-v4-pro` and
`deepseek-flash`. The implementation uses that conservative capacity for those
exact configured IDs, reserves 3,000 output and 2,000 overhead units, and clamps
the application budget. An unknown model uses a conservative 16,000 capacity
(11,000 input after reserves). These are documentation-backed mappings checked
2026-10-15, not automatic discovery of account-specific model limits.
Sources: [model details](https://api-docs.deepseek.com/quick_start/pricing/) and
[token estimation guidance](https://api-docs.deepseek.com/quick_start/token_usage/).

The system prompt, current project evidence, private memory, saved summary and
recent dialogue all count toward the working budget. Oversized mandatory context
fails before summarization rather than silently removing the user's request.

## Compaction and persistence

At 75% of the working budget, the planner summarizes older whole turns, aiming
to leave roughly half the budget plus summary room. Each summarizer input is
bounded separately. At most eight summary calls can be made per request; an
oversized backlog fails clearly instead of making unlimited calls. The latest
user request is always retained. A summary must be nonempty, at most 6,000
characters and 10,000 UTF-8 bytes. The same configured generation provider makes
structured summary requests with a 2,500-token output cap.

Summary content is introduced as untrusted historical dialogue in a user message.
It cannot authorize actions or become cited project evidence/reviewed memory.
Summarization is lossy; the source messages remain available in the transcript.
Summaries distinguish user statements from assistant suggestions and unverified
claims, but these are prompting requirements, not a factual correctness guarantee.

The summary and generated assistant message save in one transaction, after
rechecking active account/membership and conversation ownership. Invalid/failed
summaries and failed answer persistence do not advance the durable boundary.
The submitted user message stays saved on failure. Retrying a whole HTTP message
still creates a new user message; automatic idempotent retries remain future work.

Per-conversation PostgreSQL advisory locks reject overlapping chat requests with
`CONVERSATION_BUSY`. Four active turns per backend process leave database-pool
capacity for work inside the turns; excess receives `CHAT_CAPACITY`. These are
bounded synchronous requests, not a durable distributed run queue. Advisory locks
require session affinity; a transaction-pooling proxy is not a supported connection
mode for this path without a different locking implementation.

Unsummarized input is checked before loading and limited to 2,000 messages/8 MiB.
Summary usage counters record successful committed compaction usage separately
from answer usage. Failed/interrupted calls can incur provider charges absent from
these counters; this is not a complete billing ledger or daily-spend enforcement.

## Privacy and scope

Each context lookup/commit uses the owning conversation, actor and project, plus
active account/membership and non-deleted conversation checks. All Workspaces does
not broaden private history lookup. Existing saved conversation replies can
contain previously retrieved evidence or memory; this feature does not erase or
retroactively reauthorize those historical snapshots. Removing saved memory still
does not erase old messages. [History exclusions and dependency invalidation](CONVERSATION_HISTORY_RECALL.md)
provide a separate control for future conversation context and retrieved dialogue.

## Release and verification

Apply `1792022400000-ConversationContext` explicitly before running this version.
It backfills stable message sequence numbers using timestamp/ID ordering, creates
indexes and a private summary table with composite ownership references. This
updates the existing message table and takes locks; review capacity for a large
persistent database. It never deletes transcript rows. Do not edit applied
migrations or auto-run them on startup.

Automated tests cover more than ten retained messages, bounded whole-turn
compaction, oversized latest requests, invalid summary failures, owner isolation,
service restart persistence, revocation during summarization, optimistic stale
commits, advisory-lock release and transactional answer/summary rollback. Database
checks use the dedicated PostgreSQL fixture, and summary responses are scripted.
No live long-context quality evaluation is implied by those tests. See the
implementation guide for actual executed checks and rollout status.

### Local activation and live check (2026-10-16)

The local development database now has the context migration, with no pending
migrations. Existing user, project and message counts were unchanged by activation.
A live DeepSeek V4 Pro service-level evaluation used 112 synthetic messages
(112,793 UTF-8 bytes) at the default budget. It passed early-fact recall after
compaction, correction after recreating the context service and database pool,
and fresh-conversation isolation. Temporary records were removed.

The successful run used one summary request and three answer requests, reporting
29,712 prompt tokens and 66 completion tokens in total. The first check including
compaction took 4.20 seconds; the later checks took 1.14 and 0.54 seconds. These
are single synthetic examples, not a latency benchmark or a general recall score.
An earlier run failed during summarization and cleaned up; its provider usage is
unknown. The evaluation called the context service directly with a minimal system
prompt, so it does not establish authenticated HTTP, full chat orchestration, or
browser behavior. Production activation remains separate.
