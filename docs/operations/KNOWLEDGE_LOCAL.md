# Local external knowledge integration

The current local demo selects `mba-mit-demo`, containing three explicitly
user-approved MIT OCW PDFs for noncommercial local use. The original synthetic
`mba-business` collection remains available. Connect/check a selected collection
with `node scripts/connect-knowledge-local.cjs --collection mba-mit-demo` (append
`--check` for read-only validation), then restart the local backend if its private
configuration changed. Omitting `--collection` preserves the configured collection.
The older `verify-knowledge-local.cjs --live` expects synthetic fixtures; use
`verify-mba-demo.cjs --live` for the real corpus and normal RENTIFY project access.
It reports missing course citations as LIMITED, not fully grounded successes.
Read sibling `oscar-knowledge/docs/KNOWLEDGE_HACKATHON_READINESS.md` for measured
results, startup, actual outage checks and unresolved grounding limitations.

The local knowledge connection is enabled in the ignored backend `.env`. The
shared internal token is copied from the sibling knowledge service without
printing it. Default tracked configuration remains disabled. Existing workspace
retrieval, model settings, embeddings and MAVIS behavior stay in OSCAR.

## Connect and start

From the sibling `oscar-knowledge` directory, follow its README setup first. Then:

```powershell
cd C:\Users\User\study-workspace\OSCAR\oscar-backend
pnpm knowledge:connect
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -SkipAgents
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -CheckOnly -SkipAgents
pnpm knowledge:check
pnpm knowledge:verify
```

Build the frontend after changing UI code, then restart only the corresponding
local frontend process. The launcher reuses already healthy processes and does
not hot-reload changed bundles. It now attempts to start the sibling knowledge
API when local knowledge is enabled and its readiness endpoint is unavailable.
Failure to start that optional service does not block normal OSCAR startup.
Check-only status includes Knowledge when enabled. No database is reset or seeded.

The connection helper refuses any backend database other than loopback
`43104/oscar`, checks service authentication and the `mba-business` catalog,
then updates only the five `OSCAR_KNOWLEDGE_*` variables. Use `--check` to validate
without writing. Rotating the service token requires rerunning `knowledge:connect`
and restarting the local backend. Never copy provider keys between services.

## Use it

Open <http://localhost:43100/assistant>, sign in with your existing local account,
select an ordinary Assistant chat and check **Course knowledge**. Ask:

> Using the synthetic Pricing experiments notes, how should Rentify test a basic
> and premium subscription? Answer in two short sentences and cite the notes.

Click the numbered citation to inspect the source excerpt, course, institution,
section and source link. Numbers may be greater than 1 because workspace evidence
shares the same ordered, budgeted list. `DEMO-PRICING` is original synthetic CC0
material. Its example.org URL is a fixture provenance identifier, not a hosted
university resource. MIT entries have not been approved or imported.

The checkbox is per-turn and starts off. It affects ordinary assistant generation;
Hermes/T3/Paperclip execution paths are separate workflows. With it off, no new
external retrieval occurs; earlier course discussion can remain in eligible chat
history. Unavailable supplementary sources receive an explicit notice rather than
a claim that the corpus was consulted. Reusing a request ID for changed options
is rejected; the UI creates a fresh ID when options change during a retry.

## Verification

`pnpm knowledge:verify` checks local frontend proxy, normal PAT authentication and
access to the existing AIW project, without generation or writes. The PAT remains
private and is accepted by the ordinary authentication guard; no guard is bypassed.

```powershell
# Explicitly makes two real requests using the configured generation provider.
# Creates one acceptance chat in your existing local AIW project.
pnpm knowledge:verify -- --live
```

The live check verifies an actual retrieved course citation, persistence after
re-reading messages, idempotent request replay and a normal opt-out answer.
It saves a private report to ignored `var/knowledge-integration/latest.json`.
It does not approve proposals, create memories, import MIT materials, or send an
embedding request. No real provider call runs in the automated unit tests.

2026-10-25: the live check passed with the pre-existing configured `deepseek-flash`
model. A browser composer submission also returned a correctly numbered course
citation. These checks use the real model, independent knowledge HTTP API and
persistent isolated local development DB; the earlier optional smoke test still
uses scripted generation in a disposable test DB. Source licensing and large
corpus quality/scale work remain separate.

The rebuilt source preview was checked in the browser: it shows
`OSCAR synthetic fixtures (not MIT) · DEMO-PRICING`, the section locator and the
exact HTTPS provenance URL. Screenshot: ignored
`var/knowledge-integration/citation.png`. Three real generation requests were
made during acceptance (two in the explicit verifier and one through the composer).
A deliberate knowledge API shutdown verified real connection-refusal fallback
while the OSCAR backend stayed healthy. The updated launcher restarted the API
and frontend successfully; all three services finished ready. No existing app
data was reset, no migration was pending, and no personal memory was created.

Final checks for this follow-up: 49 relevant backend unit tests and 34 frontend
tests passed; backend lint/typecheck/format and frontend lint/typecheck/build
passed. The existing full regression results from the initial implementation
remain recorded in the implementation guide. The OSCAR MCP connection recovered
after backend startup and returned no accepted decisions for AIW.
