# OSCAR agent handoffs

OSCAR chat supports the same reviewed task → agent work → result → OSCAR reply flow for Hermes, T3, and Paperclip. Select a project, choose an executor in the composer (or say “use Hermes”, “use T3”, or “use Paperclip”), and review the task before starting it.

| Executor  | Work target                                                            | Progress and stopping                                                                              | Result in OSCAR                                                                   |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Hermes    | Selected OSCAR project, its permitted sources and conversation context | Existing bounded local runtime, tool progress, cancellation, source revision checks                | OSCAR summary plus the expandable, complete Hermes artifact                       |
| T3        | Selected connection, T3 project and available model                    | Approval-required runtime, native thread, durable polling, confirmed interrupts                    | OSCAR summary of the delegated run's final assistant message                      |
| Paperclip | Selected connection, agent and optional Paperclip project              | Assigned issue, native issue link, blocked/review states, cancellation where credentials permit it | OSCAR summary of the assigned agent's final issue comment after the issue is done |

## Configuration

Apply migrations before starting the updated API. `1792886400000-ExtendPlatformHandoffs` renames the former T3-only table to `platform_handoffs` without discarding existing handoffs, and adds Paperclip target metadata. Rolling back is refused while Paperclip records exist, to preserve work history. The HTTP route `/projects/:projectId/ai/handoffs` stays the same; omitted `platformType` still selects T3 for existing clients.

Hermes uses the existing `HERMES_ENABLED`, `HERMES_ROOT`, `HERMES_PYTHON`, `AI_ENABLED`, and configured model credentials. It exposes only the existing OSCAR tool allowlist. Task proposals still require separate human review. No new local shell or file-write access is introduced.

T3 requires supervised OAuth authorization as described in [the T3 guide](OSCAR_T3_HANDOFF.md).

Paperclip connections remain read-only by default. In Platforms, edit a connection, enter its company ID and an authorized bearer token, and select **Assign work from chat**. This opts OSCAR into creating and assigning issues; it does not change the agent's execution policy inside Paperclip. Add the installation's exact origin to `PLATFORM_ALLOWED_ORIGINS`; remote origins require HTTPS.

Stopping an active Paperclip heartbeat uses its board-only cancellation API. Agent credentials may permit issue assignment without permitting that operation. If cancellation is denied or the run's company/agent/issue context cannot be verified, OSCAR surfaces the failure and preserves the task's current state. Open Paperclip to manage it. OSCAR never stops an unrelated run or treats a stop request as confirmed cancellation.

## Execution boundaries

- External targets are chosen from the connected installation and revalidated before saving the handoff. Credentials belong to the current user and are encrypted at rest.
- Durable handoffs retain project/conversation ownership, connection origin, and Paperclip company/agent identity. Changing these boundaries stops tracking or requires review rather than forwarding work elsewhere.
- Local request keys prevent duplicate chat turns and handoffs. Paperclip also receives a stable issue creation idempotency key. Lost create responses are reconciled against a uniquely matching issue; they are not automatically resent.
- Paperclip result comments must match the issue, company, and assigned agent. Human comments, unrelated records, blocked/review states, and empty terminal results do not establish success. Large results are bounded and labelled when partial.
- T3 receives a routing note to prevent “use T3” from creating a second layer of delegation. Hermes uses its existing restricted runtime contract. Paperclip follows its normal assigned-issue workflow.
- OSCAR attributes reported outcomes to the executor. Full Hermes artifacts are preserved even when summarization fails. Failed or cancelled external work is reported deterministically from its status and partial progress, without model-generated claims that nothing changed.
- Excluded requests, removed project access, archived projects, or changed sources prevent later publication. No handoff automatically approves MAVIS memory or applies an OSCAR task proposal.

## API

`POST /projects/:projectId/ai/handoffs` accepts `platformType: "t3" | "paperclip"`, an owned `conversationId`, `connectionId`, stable `idempotencyKey`, and reviewed `prompt`.

T3 additionally requires `remoteProjectId`, `providerInstanceId`, and `model`. Paperclip requires `remoteAgentId`; `remoteProjectId` is optional for a company-level issue. Target discovery is available through `GET .../handoffs/models?connectionId=…` and `GET .../handoffs/paperclip-targets?connectionId=…`. The existing list, refresh, and cancel routes are shared.

Hermes retains `/projects/:projectId/ai/runs` and its conversation-linked message IDs, source checks, cancellation, and pending proposal contracts. Its raw artifact is returned separately from the OSCAR summary stored in the chat message.

## Validation — 2026-10-20

A real local Paperclip installation and OSCAR roundtrip were subsequently
verified on 2026-10-22. See [local Paperclip setup and acceptance](../operations/PAPERCLIP_LOCAL.md).
The earlier fixture-based checks below remain a separate regression record.

The provider-connected acceptance command is `pnpm verify:workflow --live --handoffs` (optional `--keep` for browser checks). It uses a disposable database, the actual configured model/embedding providers, the real Hermes subprocess, and an explicitly labelled Paperclip HTTP protocol fixture. No live Paperclip installation was available, so these checks do not claim live Paperclip execution or real board authorization.

The acceptance run passed all 16 checks, including live Hermes tools → artifact → OSCAR reply, and Paperclip issue assignment → polling → attributed result → OSCAR reply. Focused unit and PostgreSQL tests also cover consent, target scope, idempotency, uncertain dispatch recovery, cancellation, result authorship, context exclusion, and preservation of the earlier T3 workflow.

Final verification passed 32 focused backend unit tests, 39 PostgreSQL integration tests, and 26 frontend tests. Both production builds passed. Desktop browser checks covered the Paperclip review-to-result flow and Hermes review/full-artifact display without browser errors. The disposable acceptance services, database and browser credentials were removed after verification.

Paperclip's implementation follows its primary [issue API documentation](https://github.com/paperclipai/paperclip/blob/master/docs/api/issues.md), [issue validation contract](https://github.com/paperclipai/paperclip/blob/master/packages/shared/src/validators/issue.ts), and [heartbeat run routes](https://github.com/paperclipai/paperclip/blob/master/server/src/routes/agents.ts). In particular, issue completion is separate from a heartbeat ending, and active-run cancellation requires board authority.
