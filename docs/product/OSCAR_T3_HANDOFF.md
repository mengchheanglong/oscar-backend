# OSCAR → T3 → OSCAR

T3 now shares its durable handoff infrastructure with Paperclip; Hermes uses the same reviewed chat entry point and its existing local runtime. See [all agent handoffs](OSCAR_AGENT_HANDOFFS.md) and apply migration `1792886400000-ExtendPlatformHandoffs` when upgrading this version.

OSCAR chat can send a task to an installed T3 instance, follow its durable thread, read the final assistant result, and post an OSCAR summary into the original conversation.

## Using it

1. In Platforms, add or edit a T3 connection and select **Supervised work**.
2. Save and Authorize. Select **Supervised** in T3's consent screen. Existing read-only connections keep their current permissions until reauthorized.
3. Select an OSCAR project. Choose **T3** in the chat composer, or write a request containing “use T3”.
4. Review the exact task text, choose the T3 connection, project, and an available model, then select **Start T3 work**.
5. Follow the work card. If T3 needs approval or input, open its native thread to respond. OSCAR returns the result to the same chat when the delegated run ends.

Only the reviewed task text is forwarded. Project documents, private memories, and the rest of the conversation are not automatically shared. T3 executes in the selected project's existing checkout, with `approval-required` runtime mode. This first version does not create worktrees or automatically approve T3 requests.

A routing note tells T3 that it is already executing OSCAR's handoff and should complete the task directly. This prevents a user's “use T3” wording from starting a second layer of T3 delegation.

## Reliability and access

- A handoff and user message are persisted atomically before dispatch. Repeated requests with the same key and payload return the original handoff; changed payloads are rejected.
- T3's launch tool has no retry key. OSCAR persists `DISPATCHING` before calling it and never automatically resends an uncertain launch. Refresh can reconcile a uniquely matching thread title in the selected T3 project.
- Background polling resumes queued and active work after API restarts. A database advisory lock prevents multiple API processes from dispatching or publishing the same handoff concurrently.
- The connection owner, current project role, conversation ownership, connection origin, and actual OAuth operate scope are checked. Changing a connection's location stops tracking rather than redirecting previously approved work.
- Excluding the originating request prevents subsequent forwarding or result publication. Removing access or a connection stops tracking; external work that already started must be checked in T3.
- Stop requests await T3's terminal acknowledgement. Lost connections never imply that external work stopped.
- Results are paginated and selected from the final assistant message for the delegated run, not from an early progress message. A completed run without a readable answer is not marked successful. Partial transcripts are explicitly labelled.
- OSCAR summarizes T3's reported work without claiming independent verification. If its model is unavailable, it preserves T3's result directly. No result is automatically approved as MAVIS memory.

## API and storage

Migration: `1792800000000-CreateT3Handoffs`. Apply normal database migrations before starting the updated API.

Routes under `/api/v1/projects/:projectId/ai/handoffs`:

| Method | Route                    | Purpose                                             |
| ------ | ------------------------ | --------------------------------------------------- |
| GET    | `?conversationId=…`      | Owned handoffs in a conversation, latest 100        |
| GET    | `/models?connectionId=…` | Available models from the connected T3 installation |
| POST   | `/`                      | Save a reviewed task for dispatch                   |
| POST   | `/:id/refresh`           | Refresh or reconcile without resending              |
| POST   | `/:id/cancel`            | Cancel queued work or request a T3 interrupt        |

States: `QUEUED`, `DISPATCHING`, `UNCERTAIN`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `CANCELLED`. `FAILED` can also mean OSCAR stopped tracking after access or context changed; its notice explains this and does not claim the external task stopped.

## Acceptance evidence — 2026-10-19

The real installed T3 was connected through PKCE OAuth with read and operate scopes and supervised consent. A disposable T3 project received a JavaScript review task, completed it using its Codex provider, and returned a durable assistant answer. OSCAR read that answer, summarized the empty-array `reduce()` bug and corrected function, and posted the expected outputs `0` and `10` in the original chat.

The live test covered a review task, not filesystem edits or command approvals. PostgreSQL regression tests cover idempotency, uncertain-launch recovery, native `mcp:` thread IDs, pagination, permissions, context exclusion, missing results, and summarizer failure. Temporary credentials and the disposable upstream project are removed after verification. No Paperclip installation is required for this direct workflow.

The final browser pass also selected an explicit project and model, displayed a real approval wait, requested a stop and observed terminal cancellation, then completed a direct review after the routing fix. OSCAR returned the corrected `average()` function and expected outputs `null` and `4` in the same conversation.

Verification passed: 24 focused backend unit tests, 14 handoff PostgreSQL tests, all 26 frontend tests, both production builds, backend type checking, and lint/format checks for the changed backend files. The generated OpenAPI document includes the handoff routes and request/response schemas. Test OAuth sessions were revoked, the temporary T3 project was removed, and the isolated API database and test credentials were deleted.
