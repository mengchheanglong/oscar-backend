# One assistant, with inline Hermes work

The Copilot uses one general Workspace assistant. The frontend no longer offers
the seven persona modes or a separate Agent work dialog. Legacy mode values and
unthreaded run APIs remain supported for existing clients and records.

Ordinary messages use the existing cited chat pipeline. Selecting **Use tools**
sends the same composer request to Hermes in the selected project. This is an
explicit execution choice, not automatic intent classification. All Workspaces
chat remains available; Hermes tools require a specific project. When Hermes is
unavailable, ordinary chat remains available and the tool control explains why.

## Persistence and scope

Create a run with optional `conversationId`. It must be a live conversation owned
by the authenticated user in the same project. The server atomically creates the
run, its user message and a pending assistant message. The response includes
`conversationId`, `userMessageId` and `assistantMessageId`. Successful work fills
the assistant message inside the run-completion transaction. Normal follow-ups
therefore use the saved report through the existing conversation context service.

`GET /projects/:projectId/ai/runs?conversationId=<uuid>` returns this thread's
private work. Deleted conversations cannot be retrieved through that filter or
the individual-run endpoint. Project-wide lists omit deleted conversation runs.
Legacy unthreaded runs remain available through the existing project run API;
they are not automatically copied into conversations or re-executed.

The frontend polls inline progress, supports cancellation, and opens the existing
proposal-review dialog for generated drafts. It does not silently apply changes.
Results and their source metadata stay in the thread after reload. A retry first
loads the request into the composer for review; sending starts a new attempt.

Creation retry identity includes the conversation and prompt. A short transaction
lock serializes matching retry keys, so simultaneous transport retries create
one run and one canonical turn. Normal chat and run creation share a conversation
lock; normal chat rejects new turns while that thread has active work. The existing
one-active-run-per-user/project policy is retained across conversations.

## Context and privacy

Hermes receives query-aware reviewed private memory and a bounded recent-thread
snapshot: at most ten completed, nonexcluded messages, 2,000 characters each,
within 24,000 serialized UTF-8 bytes. This is historical dialogue, explicitly
marked untrusted and distinct from the current request and project evidence.
It is not full transcript compaction or a private-history search tool for Hermes.
Those remain separate future work. Normal Copilot retains its durable summaries
and older-history retrieval.

The server captures the user/project history revision before starting. Tools and
final publication revalidate access and privacy revision. History exclusion or
deletion while a run is in flight prevents its artifact and proposal being saved.
Cancellation/failure marks only pending assistant placeholders failed; late output
cannot overwrite a cancelled run. A privacy change does not necessarily stop a
model call already in progress, but its stale output cannot be published.

Migration `1792281600000-ThreadedAgentRuns` must be applied explicitly before
starting the updated backend. It adds nullable links and leaves existing records
in place. It has been applied only to isolated local development and test DBs.

## Verification

PostgreSQL regressions cover concurrent creation retries, canonical turn storage,
bounded thread input, conversation/user isolation, overlapping normal chat,
history exclusion during work, hidden conversations and cancellation/late output.
The full backend test suites pass, including existing memory/history regressions.

Local browser acceptance used a temporary conversation: real Hermes called
`calculate_pricing` with price 20, variable cost 8, fixed cost 50 and 10 units.
Its saved report gave operating profit 70. After reload, a normal Copilot follow-up
answered `$70`; the thread contained four messages and one original work prompt.
The temporary conversation was then hidden through the normal deletion endpoint.
No project records or proposals were created by that scenario. Mobile and desktop
screenshots were inspected. These checks do not establish general model accuracy.
