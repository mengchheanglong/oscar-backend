# Phase 3: explanatory retrieval and permissioned passage windows

Implemented 2026-10-30 for required-source Assistant/MCP turns. Existing exact
calculation and whole-unit support review remain in force. This checkpoint does
not certify complete answers or PDF extraction.

## Retrieval and evidence

- Plan at most four searches from the user's request before attached source
  blocks, with concurrency two. Keep the original search and prioritize distinct
  requested concepts and named books when selecting evidence.
- Each search requests at most 20 results. Merge fairly into a pool of 20 by
  default, configurable from 20 to 40. Word/depth/coverage heuristics, soft
  exercise/navigation penalties and deduplication rank candidates. Existing
  graph hints may contribute at most two selected passages. No model reranker
  or graph rebuild is added.
- Select at most ten passages and attempt two expansions from distinct
  books/documents. Automatic windows use radius one: anchor and up to two
  neighbors within the same current prepared document/revision. They cannot
  cross prepared-document boundaries or reconstruct a whole chapter/book.
- Keep each original span separately with its own author, edition, page/time,
  locator and identity. Neighbors never borrow the anchor's page or graph path.
- Focused excerpts remain contiguous original substrings with codepoint
  `sourceSpan` offsets. `contextWindow.sourceTextSha256` identifies the full
  original chunk; the existing snapshot hash identifies the actual model
  excerpt. These hashes intentionally describe different objects.

The normal context ceiling remains 16,000 characters, with enhanced reference
and project budgets of 12,000 and 3,000 respectively. Existing business/synthesis
budgets remain 32,000/26,000. Assembly preserves valid Unicode and updates span
offsets when clipping. Window notices explain that surrounding text may still
be omitted. A short lecture outline remains a short source.

## Contracts and access

Authenticated `POST /api/v1/knowledge/passage/window` accepts chunk/document/
revision, optional radius 0–2, character limit 1–16,000 (default 12,000) and
UTF-8 text-byte limit 1–64,000 (default 48,000). The read-only MCP tool is
`get_knowledge_window`; reconnect cached clients to discover it. The signed
service equivalent is `POST /internal/v1/passage/window`.

Return one to five whole original chunks, individual SHA-256/byte counts,
relative offsets, totals and `contextLimited`. Internal serialized JSON is
bounded to 96,000 bytes; the backend stream ceiling is 100,000. Budgets omit
whole neighbors, never silently truncate original chunks. Oversized anchors
return 413.

Every neighbor independently passes current eligibility and existing passage
inspection authorization. Signed private identity binds the raw request; owner
overrides are rejected. The anchor is checked again before returning. Current
grants, approval, revision, generation, deletion and exclusion remain authoritative.
Backend checks verify identities, collection/book consistency, uniqueness,
hashes, codepoint counts and totals.

Expansion 403/404/409/410 removes that source, including its earlier preview,
from answer context. Optional timeout/unavailability or window-budget failure
may retain an already retrieved preview, with a safe failure audit code. The
existing retrieval deadline reserves the smaller of 4.5 seconds and one quarter
of its budget for windows. Internal window work has a four-second deadline;
cancellation cannot forcibly stop an executing read-only DB thread, which
retains the existing SQL statement timeout.

## Controls and verification

`OSCAR_KNOWLEDGE_EXPLANATORY_ENABLED=true` is default; `false` restores the legacy
retrieval/context path. `OSCAR_KNOWLEDGE_CANDIDATE_LIMIT=20` is the selected
default. Comparing 40 on development questions produced more exercise-heavy
material in one case. This small development judgment is not an independent
accuracy result. Actual `.env` files and generation/embedding models are unchanged.

Checks: 704 backend unit tests, 179 HTTP tests, seven runner tests, lint,
typecheck, build, format and generated OpenAPI; Knowledge 185 passed / one
skipped, Ruff and mypy. Adversarial checks cover private owner/exact-reader
access, denied/revoked readers, body tampering, excluded neighbors, stale
revisions/generation, Unicode/budgets, malformed responses and deadlines.

Twenty live development responses covered eleven distinct questions, including
20/40-candidate comparisons. All 112 evidence occurrences matched permissioned
original text and recorded spans/hashes. A fresh MCP client verified three full
window spans against individual inspection. Three retries preserved replies,
citations and snapshots, including a calculation receipt and a failed calculation
state. Evaluation transcripts are preserved but excluded from future context.
The reserved set was unused.

Concept/table questions recovered useful explanatory material. Earlier labor
economics runs succeeded, but the final default-20 run failed closed with
`INPUT_EXTRACTION_UNAVAILABLE` after about 31 seconds. It was not rerolled.
Structural coverage and same-provider review are not independent semantic review.
Latency, extraction failures, exercise contamination, cross-book reasoning and
source fidelity remain limitations. No reimport, migrations, reembedding or full
semantic graph was performed. Counts, 200 sampled PDF hashes, catalog/grant files,
configurations and frozen datasets were preserved.

Private receipts and limitations:
`D:/AI/OSCAR/Knowledge/Catalog/reports/knowledge-intelligence-phase3/2026-10-30`.
The next phase is a selected-source quality pilot; it has not started.
