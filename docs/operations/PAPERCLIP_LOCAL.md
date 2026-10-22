# Local Paperclip installation

Installed and verified on 2026-10-22 at
`C:\Users\User\study-workspace\OSCAR\runtimes\paperclip`.

The runtime uses the official published `paperclipai@2026.1012.0` release and a
private Node 24.15.0 binary. OSCAR's Node version and personal Hermes installation
were not changed. Paperclip's configuration, embedded PostgreSQL database, logs
and secrets live under this runtime's `data/` directory. They are separate from
OSCAR's database. Keep that directory private and backed up.

Start with `npm start` in the runtime directory. The server listens at
`http://127.0.0.1:3100` in trusted local mode, restricted to loopback. No Windows
service was installed. Its health endpoint is `/api/health`.

The initial Git clone stalled; installation uses npm packages rather than that
unfinished source download. The release's Windows esbuild lifecycle hook failed
with a bundled binary version mismatch. Dependencies were installed with
`--legacy-peer-deps --ignore-scripts`; the actual server, embedded database,
dashboard and process adapter were then verified. Other AI adapter binaries
still need their own environment checks when configured.

## Verified flow

An OSCAR company and an **Installation diagnostic** process agent were created
in the real Paperclip service. The agent has no scheduled heartbeat and executes
only bounded, explicitly marked synthetic calculation tasks. It is not a general
AI harness. DeepSeek Flash and Pro were subsequently configured as described below.

The existing local OSCAR account has a **Paperclip (local)** connection with
supervised assignment enabled and encrypted credentials. The verification
conversation is named **Paperclip installation verification**.

The real flow passed:

1. OSCAR reviewed handoff API created and assigned one Paperclip issue.
2. Repeating the same idempotency key reused the handoff.
3. Paperclip started a real local process with run-scoped credentials.
4. That process calculated revenue `200` and operating profit `50` from price
   `20`, variable cost `5`, fixed cost `100`, and quantity `10`.
5. The agent posted its report and completed issue `OSC-1`.
6. OSCAR read that assigned-agent comment, summarized it with the configured
   model, and posted an **OSCAR / Paperclip** reply in the original conversation.
7. Paperclip's dashboard displayed the completed issue. Health returned HTTP 200.

The runtime's `verification.json` contains non-secret record IDs; its
`verification-ui.png` records the dashboard check. No protocol fixture supplied
the issue status, execution or result in this test.

See [agent handoffs](../product/OSCAR_AGENT_HANDOFFS.md) for OSCAR execution,
permission, cancellation and result boundaries. The installation follows the
[official Paperclip project](https://github.com/paperclipai/paperclip) and its
[installation guide](https://docs.paperclip.ing/reference/cli/installation/).

## DeepSeek Flash and Pro — 2026-10-22

Two real OpenCode agents now use OSCAR's existing DeepSeek key through
Paperclip's encrypted secret reference:

| Agent          | Model                            | Use                                           |
| -------------- | -------------------------------- | --------------------------------------------- |
| DeepSeek Flash | `oscar-deepseek/deepseek-flash`  | Primary, preselected for the local connection |
| DeepSeek Pro   | `oscar-deepseek/deepseek-v4-pro` | Explicit choice in the agent selector         |

Requests go directly to `https://api.deepseek.com/v1`. Separate working folders,
sessions and narrowly permitted task helpers are under the Paperclip runtime's
`agents/` directory. No scheduled agent runs are enabled. OpenCode's automatic
permission bypass is disabled; tools use the dedicated workspace configuration.

Both live model handoffs passed: each read its assigned task, wrote the formulas
and correct revenue `493` / profit `254`, posted a final Paperclip agent comment,
completed its issue, and produced an OSCAR reply in the original conversation.
Paperclip recorded nonzero input/output token usage for each selected model.
The runtime's `deepseek-verification.json` records the public IDs and results.
The API key was absent from the checked workspace and instance log files.

Custom-model cost estimates may appear as zero or be misattributed by upstream
OpenCode/Paperclip billing metadata. These remain paid direct DeepSeek requests;
use the DeepSeek account's usage records for actual charges.
