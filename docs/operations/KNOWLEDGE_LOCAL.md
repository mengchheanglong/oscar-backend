# Local external knowledge integration

## Broad learning across the library — 2026-10-27

The current planner extends the business-only implementation below. A short broad
learning request keeps its exact original query and adds at most two subject
searches. Subject hints cover strategy/decisions, product/growth, Social
Systems, leadership/execution, AI/software/engineering, finance/quantitative
reasoning, communication/writing, psychology, physics and economics. More specific
subjects take precedence over MBA/engineering umbrella labels; mixed subjects
receive one expansion each for at most two subjects. Additional subjects remain
in the original query, not a promise of exhaustive topic coverage.

Unknown subjects and extra topic qualifiers use the original question with generic concepts/examples hints;
they are not replaced by business queries. Explicit named-source, comparative,
numeric and focused requests retain one original query. The detector uses English
learning phrases and conservative guards; it is not a multilingual semantic
planner. Permissioned collections are still selected by the existing scope, not
by subject: books in any allowed collection may support any topic.

Overview searches fetch up to 12 candidates each (36 maximum), rather than the
ordinary four. Stable topic interleaving is softly reranked across all candidates
to prefer explanatory passages over likely indexes, reference lists and navigation.
The final evidence cap remains eight, with at most two passages per source.
Strong navigation/reference signals (risk score at least two) are omitted from
overview evidence, including dense page-number lists and reference identifiers.
This is a conservative retrieval heuristic, not a source validity judgment, and
can omit useful material. Original sources and ordinary focused retrieval are
unchanged. Definitions and explanatory passages still need source-aware judgment.
If only navigation candidates remain, the answer gets no reference evidence and
the normal no-matches notice rather than a claim of source-backed teaching.

The existing three-search deadline, source diversity bounds, context ceiling,
citations, owner isolation and opt-out remain. Broader reference context and
teaching guidance now apply across detected learning subjects. The assistant
must stay within the question and avoid forcing a business/project application
onto unrelated lessons. No PDF reprocessing, index mutation or provider change
is part of this work.

Verification: 501 backend unit tests and 173 E2E tests passed, along with lint,
typecheck, production build and formatting. Checks include known and unknown
subjects, mixed subjects, specific qualifiers, source-request guards, signed
owner scoping, shared deadline expiry, partial retrieval failure, source caps,
navigation-only evidence and the ordinary four-result bound. Live checks use
ordinary authentication through the existing frontend API and stable retry IDs;
private receipts and sample answers stay in ignored `var/library-learning`.
No new browser UI flow is claimed: this change is in server retrieval/context.

Three bounded live rounds (15 generation requests with the existing provider)
tested unassisted short questions about leadership, psychology, software,
physics and MBA lessons. Final responses had 4/4/5/5/6 external citations, with
matching saved-message reload and idempotent replay. Manual sample review found
substantive passages on Grove's task-relevant maturity, conditioning, software
fault tolerance/testing, Newton's second law and contribution margins. Physics
contents-page evidence in an earlier round was replaced by explanatory mechanics
pages after the navigation filter and query refinement.

Some glossary, reference-pointer and book-endorsement material still appears.
The filter is not exhaustive metadata detection. The examples establish useful
retrieval across subjects, not complete curricula, verified historical anecdotes,
or claim-by-claim grounding of model output. Source-quality notices, edition
uncertainty and the deferred PDF cleaning backlog remain applicable.

## Earlier business-only implementation — 2026-10-27

Short broad business/MBA learning requests use three bounded topic searches:
strategy/customer value, unit economics/cash flow, and markets. This addresses
the original `lessons of doing business MBA` question returning mainly an ethics
oath and chapter openings. Specific or named-source questions keep the original
query. This is a deterministic introductory-business heuristic, not a general
curriculum planner or coverage guarantee for every discipline or language.

Each search keeps the same permitted collections, authenticated owner signature,
response limits and shared retrieval deadline. A successful topic's evidence
survives another topic's failure. Merge order alternates topics, removes duplicate
chunks and limits each source to two passages (eight total). Navigation/index and
glossary text is softly deprioritized, not deleted or certified as invalid.

Overview context reserves 9000 characters for references and 6000 for project
evidence within the unchanged 16000-character ceiling; individual reference
blocks are capped at 1600 characters including metadata. Ordinary queries retain
their previous budgets. No additional generation call or model change is needed.
Teaching must distinguish sourced principles from project recommendations and
must not use indexes as substantive support or infer corpus-wide gaps from a
small retrieved sample. This does not guarantee every generated claim is grounded.

Verification: 469 backend unit tests and 173 E2E tests passed, plus lint, typecheck,
build and format. After final query/prompt refinement, all 36 affected tests and
the build passed again. Normal local authentication, private-scope readiness and
owner-scoped collection checks pass. Live acceptance uses the ordinary frontend
API with the original short prompt and the existing generation provider, without
naming source books. Two real requests completed; the final answer cited six
passages from shared MBA and private Social Systems sources, including Playing
to Win, Kotler's segmentation discussion, customer value and CVP/contribution
margin teaching. Reading-index support seen in the first run was replaced with
substantive segmentation passages after refinement. Saved citations survived
message reload and identical-request replay. These are sampled answers, not a
universal correctness guarantee. Private receipts, responses and stable retry IDs stay under
ignored `var/business-overview`. The browser CLI stalled this round; live checks
use the normal authenticated app API, not a fresh browser-flow verification.

## Current unified chat behavior — 2026-10-27

The local composer starts with one **Knowledge** checkbox enabled and searches
all permitted reference sources alongside ordinary project context. There is no
MBA/Personal Library/Social Systems selector. Categories remain metadata for
provenance and access control; original data and grants are preserved.

Authenticated chat API requests with `includeKnowledge: true` default omitted
`knowledgeScope` to `all`. Explicit legacy scopes remain compatible. Omitted or
false `includeKnowledge` still opts API callers out. Scope participates in retry
identity: changing a saved unified request to MBA-only is rejected.

The normal local authentication and private-owner readiness checks pass. A live
combined-book question exposed the existing 5000 ms SQL statement limit. The
local Knowledge budget is now 10000 ms per statement and the app request budget
is 25000 ms. Tracked defaults remain 5000 and 2500 respectively; the app permits
bounded overrides up to 30000 ms. The connector preserves a configured budget.
Readiness is not inferred from a failed collection-status request. Missing or
unavailable supplementary retrieval still produces an explicit answer notice.

Do not change generation-provider settings, copy private data into shared
collections, or reset databases to unify the experience. Existing source OCR,
edition and full-transcription limitations remain. PDF cleaning is still deferred.

The sections below describe earlier scoped-picker behavior and historical checks.

Current verification: 458 backend unit and 173 E2E tests passed; lint,
typecheck, build, format and regenerated OpenAPI passed. Knowledge passed 131
tests with one optional model test skipped, plus Ruff/mypy. Frontend passed 34
tests, lint, typecheck and production build. Real browser tests retrieved both
personal-library and social-systems books in one answer, then shared mba-majors
course citations through the same default scope. Physical-page previews survived
reload; a fresh opt-out turn produced no external citation buttons. Authentication
and owner-readiness scripts pass. Private screenshots/receipt are in
`var/unified-knowledge` (ignored). This is bounded integration acceptance: one
answer used prose bibliographic references without interactive markers; a later
numbered-citation request returned both clickable previews. It does not establish
universal citation or source-factual correctness.

## Private reference library

The local private library is available through the same service and composer.
Enable **Reference knowledge** and select MBA, Personal Library, Social Systems,
or All permitted references. As of 2026-10-26, private scope has 1,040 searchable
references, 24,542 active document parts and 261,212 local Qwen chunks/vector
rows. These include HTML sections, supplements and bounded compilation windows;
they are not distinct-book counts. All 672 original PDFs / 198,758 physical pages
are accounted for; 18 additional references are reviewed non-text, with no
fabricated passages. No partial references or unresolved pages remain. All 43
Social Systems roadmap readings have indexed matches. Source editions,
illustration labels and OCR formulas still require judgment. See sibling
`oscar-knowledge/docs/LIBRARY_COMPLETION_2026_10_26.md` for evidence and limits.
Choose **All permitted references** to include privately added MBA PDFs and page
supplements; MBA-only retains the approved shared corpus.

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

`--live --compilation` also checks a bounded physics answer with an actual
physical-page citation and unverified compilation attribution. The local backend
uses `OSCAR_KNOWLEDGE_TIMEOUT_MS=8000` for the expanded exact-search library; the
tracked default remains 2500 ms. Restart the local backend after changing its
ignored configuration. The first physics attempt safely reported unavailable
sources under the old budget and is retained in saved history. A separate stable
recovery request passed with page 110908; repeated verification reuses saved IDs.
Five scripted cases now pass, alongside the earlier browser citation check.

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
