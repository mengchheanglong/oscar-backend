# Hermes runtime integration

The operational copilot can execute bounded project work through Hermes. The
existing chat/provider path remains available. Select **Agent work** in the
copilot to start a separate, private project run and inspect its report.

## Contract and boundaries

- Workspace: identity, access, project evidence, reviewed memory, run records,
  reports and proposal review. Hermes never receives a workspace PAT or session.
- Hermes: the existing Python `AIAgent.run_conversation` model/tool loop, using
  the existing configured `AI_CHAT_MODEL` and DeepSeek key. The integration does
  not change the selected model or install a second API framework.
- Adapter: an owned Python subprocess with a minimal environment and a fresh
  temporary Hermes profile. Source `.env` files, personal profiles, plugins,
  memory tools, shell/browser tools and dynamic tool discovery are excluded.
  An explicit dispatch guard rejects unlisted tool calls before upstream built-in
  dispatch, independently of which schemas the model sees.
  Runtime source must match the pinned revision and have no tracked edits.
- Three tools only: `search_project_evidence`, `calculate_pricing`, and
  `request_task_review`. Authorization is checked before each tool and before
  committing a result. Search is restricted to one active project; reviewed
  private memories belong to that actor/project.
- A task request stages one draft linked to an existing same-project
  requirement. On success, the report and a pending proposal save atomically.
  The existing proposal review/confirmation service enforces role permissions,
  privacy, source versions, expiration and transactional/idempotent task creation.
  No agent tool can confirm a proposal or create a task directly.
- Reports are private Markdown in `agent_runs.artifact`, not automatically
  published documents or GitHub commits. Retrieved source metadata is recorded
  separately; its presence does not independently verify every generated claim.
- Pricing is a bounded deterministic scenario estimate with explicit inputs,
  floating-point precision, and no data fetching. It is not an accounting ledger.

## Prepare the runtime

Pinned source: `NousResearch/hermes-agent` at
`b9aa9289a8083f2e9d248ad6837b2938f5ee92d7` (MIT).
The adapter was verified against that revision, not an arbitrary newest checkout.

```powershell
git clone https://github.com/NousResearch/hermes-agent.git <dedicated-runtime-directory>
git -C <dedicated-runtime-directory> checkout --detach b9aa9289a8083f2e9d248ad6837b2938f5ee92d7
```

Prepare a Python environment using that revision's own documented installation
requirements. Do not run the personal gateway or copy its `.env`, profile,
sessions or memory into the dedicated checkout. The Python interpreter must have
Hermes dependencies; the bridge imports source from `HERMES_ROOT` explicitly.

For the current Windows machine, a clean dedicated checkout was prepared at
`C:\Users\User\Internship\ai-workspace-runtime\hermes-agent`. Its import/protocol
probe passed using the already prepared interpreter at
`C:\Users\User\AppData\Local\hermes\hermes-agent\.venv\Scripts\python.exe`.
The personal installation was not changed. These are machine-specific paths,
not production container configuration. Keep the source revision and prepared
environment compatible; repeat the probe after runtime dependency changes.

Probe without credentials or model requests:

```powershell
$env:AIW_HERMES_ROOT = '<dedicated-runtime-directory>'
& '<prepared-python-executable>' scripts/hermes/bridge.py --probe
& '<prepared-python-executable>' scripts/hermes/test_bridge.py
```

The second command runs the real Hermes loop with simulated HTTP responses. It
checks the model and exact tool list on every request, three permitted tool calls,
an attempted unlisted terminal call, direct dispatch rejection, and the final
artifact. It is not a live provider test.

## Release configuration

1. Apply the backend migrations explicitly in the intended release environment:
   `1791072000000-CreateCopilotMemories` and
   `1791504000000-CreateAgentRuns`. Both were applied to the configured persistent
   database during the authorized local enablement on 2026-10-09. New release
   environments must still run their own explicit migration step.
2. Keep existing AI provider settings and budget configuration. Configure absolute
   `HERMES_PYTHON` and `HERMES_ROOT` paths and set `HERMES_ENABLED=true` only after
   preparing the runtime. `AI_ENABLED=true` and a DeepSeek credential are required.
   Values remain in the environment/untracked `.env`; never put keys in source.
3. Restart the backend and deploy the verified frontend when release is authorized.
   The backend Docker image includes the bridge but has a Node-only runtime; it
   does not contain Git, the prepared Python environment or Hermes source. Keep
   Hermes disabled there until the deployment image explicitly supplies those
   dependencies. Frontend Vercel needs no Python.
4. In a restricted project, select Agent work and run an actual provider-backed
   task. Local API acceptance passed on 2026-10-09 using real AIW evidence and
   DeepSeek V4 Pro. Repeat acceptance for each deployment environment. No public
   deployment has been performed.

Default is disabled. Runtime status reports configuration/file availability,
not a live provider health check. Missing dependencies, wrong/modified source,
provider failures and invalid protocol output produce safe failure codes.

## Run lifecycle and API

`GET /projects/:projectId/ai/runs/runtime` returns configuration availability.
`GET /projects/:projectId/ai/runs` lists the latest 30 private runs.
`POST /projects/:projectId/ai/runs` accepts a prompt (1–4,000 characters) and
a stable UUID `idempotencyKey`. `GET /:id` reads a private run;
`POST /:id/cancel` cancels it. Normal session/PAT authentication, CSRF and project
guards apply. No new MCP execution tools were added in this slice.

States: QUEUED → RUNNING → SUCCEEDED / FAILED / CANCELLED. A partial unique index
allows one active run per actor/project. Replaying an identical creation request
returns the original run without executing again; changed payloads conflict.
Retry is an explicit new attempt with a new UUID, not an automatic restart of a
possibly charged request. Run prompt/artifact content is excluded from audit
metadata. Start/completion audit events contain safe identifiers only.

The backend supervises local subprocesses; this is not a distributed durable
worker queue. Each run has an eight-iteration model limit, 3,000 output tokens
per request, twelve tool calls, and a three-minute subprocess deadline. A
four-minute database deadline releases abandoned queued/running attempts as
`RUN_INTERRUPTED` on list/read/new-start; they never silently resume. These are
execution bounds, not enforcement of a dollar-denominated daily spend cap.

Cancel conditionally changes active state and kills an owned process. Another
backend instance sees the cancelled state at its next tool/result boundary;
already dispatched inference can still finish and incur provider cost. A
cancelled run never saves late artifacts or staged proposals. Closing the panel
does not cancel work; reopening retrieves persisted state.

Temporary Hermes files are cleaned on normal exit where possible. Windows open
file handles or forced process termination can leave a temporary profile for
operator cleanup. Workspace PostgreSQL remains canonical memory/run storage.

## Scope and next work

This first integration proves a bounded execution path without giving Hermes
arbitrary code execution, autonomous writes, global private memory, or external
browser/network tools. Local runtime enablement and live API acceptance passed.
Next: review the saved report/draft in Copilot, then add approved tools driven by
real work. Production Python packaging and deployment remain separate release work.
Distributed workers, semantic memory retrieval and a skill registry require
separate implementation and verification.

## Local live acceptance - 2026-10-09

The local backend runs at `http://127.0.0.1:3001`. Its untracked `.env` enables
Hermes using the prepared paths above and the project-specified
`AI_CHAT_MODEL=deepseek-v4-pro`; the previous local setting was `deepseek-flash`.
Credentials remain untracked. The two additive migrations ran in one transaction;
existing project, user and task counts were unchanged.

One authenticated AIW run succeeded through real Hermes and DeepSeek. It used all
three tools, recorded nine retrieved evidence entries and cited two retrieved
chunk IDs. Its illustrative pricing report includes revenue 2,000, operating
profit 600 and break-even 50 units. This checks the supplied scenario and valid
source IDs, not independent semantic verification of every report claim.

Run `98a01c04-0892-427c-82f6-473c02ac1817` saved its report and proposal
`6e85addb-cb58-42bc-82f7-20e77d601c5e`. The proposal remains PENDING for the
initiating account's human review; task counts did not change. A concurrent
identical request returned the same run. A separate immediate cancellation
remained CANCELLED with no report or proposal after the live run finished. This
tests cancellation state persistence, not guaranteed prevention of charges for
an inference request already dispatched. Live acceptance used the authenticated
API; the earlier browser checks used synthetic fixtures. AIW MCP remained
unavailable, so no project task status was changed.
