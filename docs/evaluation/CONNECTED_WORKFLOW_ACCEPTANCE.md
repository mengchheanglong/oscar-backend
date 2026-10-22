# Connected workflow acceptance — 19 October 2026

## Result

**17 checks passed** through one synthetic launch-validation scenario across two
projects. The final run used real configured providers and a disposable PostgreSQL
database, followed by browser acceptance and a live authorization revocation check.
The additional regression suites passed **33 tests**. Backend typecheck, lint,
formatting, production build, and OpenAPI generation passed after the fixes.

This is integration evidence for the exercised paths, not a claim that every button,
file format, provider, or future roadmap feature has been tested live.

## Technology actually exercised

| Technology                                  | Verification                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js production frontend                 | Signed-in browser workflow, cross-project global search, platform activity                                                                    |
| NestJS, HTTP, session cookies, Argon2, CSRF | Real application modules, real logins, blocked foreign-user and CSRF requests                                                                 |
| TypeORM, PostgreSQL, pgvector               | Real migrations, persistence, outbox ingestion, 9 embedded chunks; vector casts verified at 1536 dimensions                                   |
| Configured DeepSeek model                   | Strategic review, fresh cross-project recall, structured task generation                                                                      |
| Configured embedding provider               | Uploaded evidence indexed and retrieved using hybrid search                                                                                   |
| Real Python Hermes runtime                  | Evidence search, pricing calculator, persisted artifact, connected local-file read                                                            |
| OSCAR MCP over stdio                        | Real child process, PAT authentication, project listing, private saved preference; no agent self-approval of MAVIS memory                     |
| Real installed T3                           | Browser PKCE OAuth, read-only scope, health, 5 projects / 3 threads / 1 latest run, native mapping, restart persistence, revocation detection |
| Paperclip adapter                           | Real HTTP requests, encrypted token, goal mapping and overview against a clearly synthetic upstream fixture                                   |

T3 was found at `C:/Users/User/AppData/Local/Programs/t3code`, with its active runtime
at `http://127.0.0.1:3773`. A short-lived pairing credential restricted to
`orchestration:read` was used. Only the test OAuth session was revoked afterwards.
The existing desktop session was retained. No upstream T3 projects or threads were
created, edited, messaged, or deleted.

## Scenario and assertions

1. Sign in, create the launch and operations projects, and reject another user's access.
2. Create a validation goal, its metric (35 / 100), an accepted decision, and linked work.
3. Upload Markdown evidence; extract, index, embed, and retrieve it through real services.
4. Search both projects' APIs using keyword/hybrid search.
5. Capture a decision memory, approve it as a human, correct its budget from 300 to 450,
   and retrieve the replacement with provenance while excluding the superseded original.
6. Ask the live model for strategic priorities: it includes 35% measured progress and
   the corrected 450-dollar budget.
7. Open a fresh all-project conversation: it recalls `ORBIT-MANGO`, the second
   project's 42-check quality gate, and the approved budget correction.
8. Generate a task draft, confirm it, retry confirmation, and verify no duplicates and
   that every generated task retains the decision's goal.
9. Run Hermes: project evidence plus pricing calculation produce the expected profit
   of 50 dollars; the runtime artifact and calculator events are persisted.
10. Connect an actual MCP child process through a real PAT, verify discovery/read access,
    and reject a PAT attempting to approve MAVIS memory.
11. Read synthetic Paperclip agents/issues through its HTTP adapter and map its native
    issue to the goal. Confirm encrypted credentials and read-only upstream requests.
12. Authorize real T3, restart OSCAR, retrieve activity through the persisted OAuth
    session, map a native thread to the goal, and combine both platform snapshots.
13. Complete task activity and verify measured goal progress remains 35%.
14. Capture successful Hermes work as a candidate, approve it, and preserve the
    distinction between reviewed memory, dialogue history, and raw execution.
15. Save a private preference, retrieve it through MCP, connect a dedicated synthetic
    local folder, and use Hermes to read its exact `LOCAL-ORBIT-73` marker.
16. In the browser, keep the launch project selected and find the operations document
    through Global search. Its project attribution and result are correct.
17. Revoke the test T3 session and verify OSCAR reports `REVOKED`.

The final dataset contained two projects, five tasks, two uploaded documents, two
completed chat replies, two successful Hermes runs, and nine embedded chunks.

## Defects found and fixed

### Generated task confirmation dropped the decision's goal

Confirmed tasks were created with a null `goalId`, disconnecting strategic progress
from generated execution work. Confirmation now validates the decision's live,
same-project goal and copies its ID into every created task. A deleted or invalid
goal requires updating the decision before confirming. Unit coverage checks the
inheritance; the live workflow verifies every created task after idempotent replay.

### Platform activity response lost its type and records in the frontend

The entities endpoint returned `{type, data}` directly. The shared frontend API
client interpreted `data` as its response envelope and removed the type/outer object.
The UI consequently displayed an empty activity snapshot despite successful T3 reads.
The endpoint now returns `{data: {type, data}}`. An HTTP regression asserts this
contract; the production UI displays the real T3 records after the fix.

Local evidence is in ignored `var/connected-workflow/`: redacted results, generated
answers/artifacts, cross-project search screenshot, and before/after activity
screenshots plus a reproduction video. Credentials and private upstream snapshots
are removed during cleanup; these files are not published or committed.

## Repeating the workflow

From `oscar-backend`, with the dedicated test PostgreSQL server running:

```powershell
pnpm verify:workflow --live --keep --authorize-t3
```

Use configured model, embedding, and Hermes credentials. The explicit `--live` flag
permits bounded real provider requests. The runner creates a unique `_test` database,
uses isolated file storage, limits the project model budget, and leaves the test API
on port 3101 while `--keep` is active. The production frontend for browser acceptance
must use the same-origin proxy pointing to that API. Neither development data nor an
upstream platform is reset by this command.

With `--authorize-t3`, the runner waits at the T3 stage for its real read-only browser
consent; sign into the isolated frontend using the generated private test profile.
Without that flag or `--reuse-t3`, the runner leaves T3 pending and does not claim a
verified T3 snapshot. End a kept run by creating `var/connected-workflow/stop.request`
so asynchronous database cleanup can finish, or use Ctrl+C where signals are supported.

T3 requires its real read-only browser consent. `--reuse-t3` is a retest-only option
using the ignored encrypted credential captured after that consent, to verify
restart persistence. The first provider run and browser consent were followed by a
full rerun with the fixes and extensions. Some initial harness assertions were
corrected to match documented API shapes; those were test-harness errors, not
application defects. Final results contain only the verified acceptance checks.

## Coverage limits

Paperclip is not installed, so its upstream service is simulated. GitHub integration
is disabled locally and was not connected in this workflow. The Knowledge graph is
still marked Coming soon. Uploaded evidence here is Markdown; this run does not
establish PDF/DOCX parser acceptance, uploaded-folder resumption, or every account
settings path. The existing broader regression suites cover additional behavior,
but are distinct from this connected acceptance scenario.
