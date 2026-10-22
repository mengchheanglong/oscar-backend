# Chief-of-staff workflow

Implemented on 22 October 2026. This builds on the supervised Hermes, T3 and
Paperclip handoffs; it does not enable autonomous work by default.

## Use it

1. In chat, choose Hermes, T3 or Paperclip and optionally select a goal in the
   current project. OSCAR validates the goal before persisting the execution.
2. Follow execution in **Tasks → Agent work**. OSCAR still returns the runtime's
   reported result to the originating chat. A runtime's successful status is not
   evidence that a business metric improved.
3. Open **Review outcome** after execution ends. Record what you checked and
   choose accepted, needs work or rejected. Failed/cancelled work cannot be
   accepted. Reviews are retained once per execution; retries reuse the same key.
4. An optional lesson on an accepted successful result creates a **proposed**
   MAVIS memory with execution, goal and review provenance. Open **Knowledge →
   Memories** to inspect, edit and approve it separately. Only approved memories
   enter later answer context. Goal measurements remain explicit operations.
5. Open **Goals → Briefing & spending** for current goals, blockers, recent agent
   results awaiting review and workspace execution spending.

## Recurring briefings

**Schedule & budget** supports off, daily, or weekly on Monday, at an integer
hour in UTC (02:00 UTC is 09:00 in Bangkok). Scheduling is off until the signed-in
user enables it. It does not authorize scheduled agent execution or provider calls.

The backend checks due schedules every minute while running. It generates a
structured workspace snapshot from existing records without an LLM call, persists
it transactionally, and advances the next due date. Locks and a unique user/due
key prevent duplicate snapshots across workers. After downtime it produces one
current briefing, rather than replaying every missed date. Snapshots are retained
for 31 days and remain private backend records; no snapshot-history API is exposed.

The Goals panel shows the last scheduled briefing time and rebuilds its facts
using current membership and chat access. It never returns an old snapshot after
permissions change. Delivery is inside OSCAR, with no email, push notification,
background desktop automation, or generated narrative summary.

## Spending boundaries

- The monthly threshold covers accessible owned Hermes, T3 and Paperclip runs
  across the workspace, even when the briefing is filtered to a project.
- Costs are entered by the reviewing user, in USD, and attributed to the UTC
  month in which the run started. Blank/null means unknown; explicit zero means
  the user reported zero. Unknown costs remain visible separately.
- The displayed sum is **user-reported execution spending**, not a provider bill.
  OSCAR chat, embeddings, untracked external work and unreported costs are absent.
- Exceeding the threshold produces a warning. It is not a hard execution cap.
  Native provider/Paperclip enforcement remains authoritative. Automatic invoice
  reconciliation, other currencies and cross-provider hard limits remain future work.

## API and access

- `GET /chief/briefing?projectId=<uuid>` — current authorized facts; bounded to
  100 goals, 50 actionable tasks and 50 recent runs. Spending aggregation is not
  truncated to that recent-run list.
- `GET /chief/preferences`, `PUT /chief/preferences` — private opt-in schedule
  and reporting threshold.
- `GET /chief/executions/:platform/:id/review` — nullable review envelope.
- `POST /chief/executions/:platform/:id/review` — human review with a stable
  idempotency UUID; conflicting payloads/second reviews are rejected.

Review and preference mutations require a signed-in browser session and CSRF.
Agent access tokens cannot approve outcomes, enable recurrence, or approve memory.
Every source is owned by the actor and rechecked against project membership and
non-deleted chats. Review and proposed memory persistence are atomic. A review
never confirms AI proposals, edits goal progress, or launches another run.

The PostgreSQL continuity tests cover retries, rollback, all three provenance
paths, deleted chats, removed memberships, unknown costs, scheduler concurrency,
and recall after a separate memory approval. Runtime discovery/authorization is
tested live separately; fixture execution tests do not establish fresh provider
inference or billing accuracy.
