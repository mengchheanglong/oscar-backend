# Local external knowledge integration

## Private reference library

The local private library is available through the same service and composer.
Enable **Reference knowledge** and select MBA, Personal Library, Social Systems,
or All permitted references. Current private scope has 487 ready references,
including HTML sections; this count is not a distinct-book count. Seven are
partially extracted and carry explicit coverage warnings. All 43 Social Systems
roadmap readings have reference matches, while most of the oversized compilation
is still unindexed. See sibling
`oscar-knowledge/docs/LOCAL_KNOWLEDGE_LIBRARY_INTEGRATION.md` for commands and limits.

Backend `.env` uses a separate `OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET`, matched to
Knowledge's `KNOWLEDGE_PRIVATE_SCOPE_SECRET`. Ordinary authentication supplies the
actual user; client collection IDs and the service token cannot impersonate an
owner. `GET /api/v1/knowledge/collections` returns only owner-scoped ready counts.
`knowledgeScope` is optional (`mba`, `personal-library`, `social-systems`, `all`)
and requires per-turn `includeKnowledge`. The default remains MBA and opted out.

`node scripts/connect-private-library.cjs --check` checks existing keys and normal
local authentication without changing permissions. Run without `--check` only to
connect keys; explicit `--approve-owned-pdfs` separately records operator-authorized
PDF checksums. Existing owned PDFs are already approved for private use.
`node scripts/verify-private-library.cjs` checks owner readiness; `--live` runs four
bounded configured-model cases, persisting request IDs privately and reusing them
on retries. Existing passed cases reload rather than regenerate. Reports under
`var/private-library` are ignored and must remain private. No provider keys or
source PDFs belong in Git. Generation settings are unchanged.

Validation: 440 unit, 173 E2E, 142 isolated integration passed; one optional HTTP
smoke skipped. Lint/typecheck/build/format and regenerated OpenAPI passed. Live
private citations/reload, idempotency scope conflicts, unanswerable abstention and
opt-out passed. Disabling the independent private-scope keys and restarting closes
private access while retaining additive schema, existing shared data and vectors.

## Shared MBA corpus

The current local demo selects `mba-majors`: 1,374 reviewed, user-approved
documents and 36,722 active locally embedded passages supporting 22 original
MBA study pathways. Import approval is limited to the noncommercial local demo,
with notices retained and 83 quarantined or unresolved items excluded. The earlier
`mba-mit-demo` and synthetic `mba-business` collections remain available.
Connect/check a selected collection
with `node scripts/connect-knowledge-local.cjs --collection mba-majors` (append
`--check` for read-only validation), then restart the local backend if its private
configuration changed. Omitting `--collection` preserves the configured collection.
The older `verify-knowledge-local.cjs --live` expects synthetic fixtures; use
`verify-mba-majors.cjs --live` for the current corpus and existing AIW project.
`verify-mba-demo.cjs --live` targets the earlier three-PDF corpus. Read sibling
`oscar-knowledge/docs/MBA_MAJORS_READINESS.md` for current measurements and limits;
`KNOWLEDGE_HACKATHON_READINESS.md` retains the earlier outage and grounding checks.

The local knowledge connection is enabled in the ignored backend `.env`. The
shared internal token is copied from the sibling knowledge service without
printing it. Default tracked configuration remains disabled. Existing workspace
retrieval, model settings, embeddings and MAVIS behavior stay in OSCAR.

## Connect and start

From the sibling `oscar-knowledge` directory, follow its README setup first. Then:

```powershell
cd C:\Users\User\study-workspace\OSCAR\oscar-backend
node scripts/connect-knowledge-local.cjs --collection mba-majors
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
`43104/oscar`, checks service authentication and the selected collection catalog,
then updates only the five `OSCAR_KNOWLEDGE_*` variables. Use `--check` to validate
without writing. Rotating the service token requires rerunning `knowledge:connect`
and restarting the local backend. Never copy provider keys between services.

## Use it

Open <http://localhost:43100/assistant>, sign in with your existing local account,
select an ordinary Assistant chat and check **Course knowledge**. Ask:

> Using the approved MBA course library, explain how WACC discounts free cash
> flow. Cite the course and distinguish teaching examples from measured results.

Click the numbered citation to inspect the source excerpt, course, institution,
section and source link. Numbers may be greater than 1 because workspace evidence
shares the same ordered, budgeted list. Course/page/timestamp locators depend on
the original source format. Retain source notices and consult original figures
and pages where text extraction loses layout.

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
# Explicitly makes three real requests using the configured generation provider.
# Creates one acceptance chat in your existing local AIW project.
node scripts/verify-mba-majors.cjs --live
```

The live check verifies an actual retrieved course citation, persistence after
re-reading messages, idempotent request replay and a normal opt-out answer.
It saves a private report to ignored `var/mba-majors/latest.json`. It checks two
course questions and one opt-out answer, and requires the `mba-majors` selection.
It does not import sources or change model settings. No real provider call runs
in the automated unit tests.

2026-10-25 MBA expansion: both finance and healthcare answers completed with the
existing `deepseek-flash` setting. Every external citation belongs to an approved,
active `mba-majors` revision. Citations survived reloading; idempotent replay
returned the same saved answers; opt-out chat returned no external citations.
The Knowledge import integrity check passed, preserving the previous 10 documents
and 68 chunks. The 22-query hybrid benchmark achieved 20 predefined source-family
hits; the other two yielded relevant alternatives inspected manually. This is
sample acceptance, not universal claim-grounding or academic-equivalence proof.

## Earlier synthetic-demo verification (historical)

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
