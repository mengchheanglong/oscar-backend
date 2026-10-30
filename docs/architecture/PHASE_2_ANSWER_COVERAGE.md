# Phase 2: structural answer coverage and bounded repair

Implemented on 2026-10-30 as an incremental replacement for sentence-only answer
assembly in required-source Assistant/MCP turns. This checkpoint adds answer
structure and failure handling; it does not certify every answer's usefulness or
finish explanatory retrieval, source auditing or the full intelligence roadmap.

## Request and answer records

The backend constructs a bounded `AnswerRequestPlan` from the current request,
before any `SOURCE`/attachment block. No unconditional planning model call is
added. Rules identify direct answers, common requested question counts, tables,
pitch wording, explanations, calculations, proposed actions, synthesis and named
source comparisons. Explicit no-application/no-personalization constraints take
precedence over advice-related words inside a negated instruction.

`AnswerBlock` records retain complete Markdown units: explanatory paragraphs,
questions with their rationales, recommendations with their adjacent decision
rules, full tables, limitations and source gaps. Common numbered, bold-numbered
and labelled-question formats are recognized. Bare headings attach to their
following content. Necessary adjacent qualifiers stay with the unit. Duplicate
question wording/ordinals do not inflate counts. Final question numbering is
presentation only; original reviewed units remain in the audit.

The structural reviewer checks all clauses/cells together and keeps or rejects
the whole unit. A unit dependent on removed context is not published. Existing
checks for original quote anchors, citation targets, attribution, numerical
claims, causality, evidence status and requested scope remain in force. Tables
must also pass column/header/row shape checks, and generated citation markers
are placed outside the table rather than appended as an extra cell.

The saved private `evidenceSnapshot.answerComposition` includes:

- The rule-derived request plan and structural coverage before/after attempts.
- Original units and support audits for the initial/companion and optional repair.
- Retained units with claim pointers to their actual review attempt/block and
  original source anchors.
- Generation attempts/model identities, repair outcome and safe failure codes.
- Hash/length of an unchanged calculator reply when present.

`answerReview` remains available for compatibility and points to the most recent
review attempt; the composition record is necessary to trace retained units from
both attempts. Existing authenticated message APIs/MCP reload these records.
Idempotent message replay reuses the saved body, receipts and audits.

## Coverage and repair

Coverage is checked **after** support filtering. Missing items are disclosed in
plain language: for example, fewer supported questions than requested, a table
that could not be retained whole, or a named source without a validated passage.
The response states that these are gaps in this evidence/review sample, not proof
that the whole library lacks information.

At most one coverage redraft is allowed. It receives the same already-authorized
evidence, original request, missing-output labels and retained approved units.
It cannot retrieve new sources, change grants, create project records, alter a
calculator receipt or reverse a support verdict. New text is reviewed again.
Approved old material remains available even if the redraft fails. A negative
verdict alone does not trigger a redraft when requested structure is covered.
Missing calculator verification is never repaired by asking a model to do math.

Review/provider unavailability, malformed review coverage, oversized requests
and exhausted budgets stop coverage repair. Shortfalls remain visible instead of
fabricating items or silently presenting an incomplete artifact as complete.

## Calculator integration

Phase 1 arithmetic and source-required publication rules are preserved. The
calculator's controlled reply is inserted unchanged and its hash is recorded.
When a question also requests explanation, a short qualitative companion can be
drafted from the existing evidence. It is reviewed separately. Generated numeric
claims, numeric words and calculations in that companion are conservatively
rejected; the model cannot replace verified results or reveal withheld outputs.

This boundary can reject otherwise reasonable quantitative wording. It is a
bounded safety/clarity trade-off, not a general financial language interpreter.
Exact arithmetic still does not verify user inputs, customer demand, accounting
outcomes or causality. Source gaps such as the Phase 1 labor-method example remain
gaps until appropriate evidence is retrieved.

`generationAttempted` now includes companion/repair drafting. Typed calculation
input extraction remains separately recorded in `calculationAudit`. The configured
DeepSeek and pinned Qwen model identities are unchanged.

## Failure diagnosis and rollout

Review audits distinguish `REVIEW_JSON_INVALID`, `REVIEW_SCHEMA_INVALID`,
`REVIEW_COVERAGE_INVALID` (missing/duplicate/out-of-order IDs),
`REVIEW_OUTPUT_TRUNCATED`, `REVIEW_LIMIT_EXCEEDED` and `REVIEW_UNAVAILABLE`.
One format-only recovery is allowed for identified invalid JSON/schema on the
first review. It uses the same claims/evidence and retains the failed format
attempt; it is not a retry of an unfavorable valid verdict. Coverage-ID errors,
truncation and provider failures do not get this retry. The repair review has
no format retry. Oversized failed drafts are bounded rather than copied without
limit into the audit.

| Setting                     | Default | Effect                                                                                                                            |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AI_ANSWER_BLOCKS_ENABLED`  | `true`  | New structural path for required-source turns; `false` restores the legacy reviewer/renderer while retaining Phase 1 calculations |
| `AI_ANSWER_REPAIR_ENABLED`  | `true`  | Allows the single optional coverage redraft; does not disable initial companion explanations                                      |
| `AI_ANSWER_BLOCK_BUDGET_MS` | `20000` | Shared deadline for structural review, companion generation and repair; valid range 1000–45000 ms                                 |

Caller abort signals reach the DeepSeek HTTP requests. The composition deadline
does not include earlier retrieval, input extraction or the initial ordinary
answer draft; it is not a global turn-latency guarantee. `answerComposition` is a
separate duration-only telemetry stage. Disabling the rollout switch preserves
source checks; it does not publish an unchecked failed draft. These defaults do
not require editing existing model credentials/configuration files.

## Verification boundaries

Tests cover whole-unit preservation/rejection, question formats and duplicate
counts, table rendering, scope negation, single repair, format-only recovery,
missing IDs/truncation/limits, deadlines, immutable calculations, withheld numeric
outputs, rollback switching, persistence and replay. Existing access-isolation
tests remain required. No database migration, corpus reimport or graph rebuild is
part of this phase.

Verification passed: 684 unit tests, 178 HTTP tests, seven runner checks, lint,
typecheck, formatting, build and OpenAPI generation. Live diagnostics retain 36
responses across 16 distinct development questions. Latest structural statuses
are 12 covered, two partial and two unanswered; a complete table includes an
explicit cash-definition gap. Final runtime examples preserve four/five proposed
question/rationale pairs, a whole comparison table, no-personalization scope and
unchanged churn math with a reviewed explanation. Other definitions, named-source
synthesis and a numeric companion still have unresolved support gaps.

All 69 distinct captured reference excerpts matched authorized original passage
re-reads. Real replay preserved complete saved snapshots and bodies for both a
five-question artifact and a numeric-plus-explanation reply, without duplicate
messages. Source/catalog/grant/configuration-file fingerprints and Knowledge
counts remain unchanged. These are provenance/preservation checks, not full-page
corpus audits or independent semantic certification.

Private live diagnostics use selected frozen development questions and additional
explicit development cases. Evaluation transcripts remain stored but are excluded
from recall through the normal API before subsequent cases. Original attempts are
retained rather than overwritten. Reserved questions remain untouched.

`COVERED` is a **structural heuristic**, not independent proof that every requested
concept was semantically answered. A complete table can contain an explicitly
scoped missing-data row. A positive review remains a model judgment, not a gold
label or calibrated probability. Rules do not parse every natural-language format,
word limit, complex dependency or arbitrary multipart request. Whole-unit checking
can sacrifice a useful clause when another clause in the same unit is unsupported;
the bounded repair may recover a shorter supported unit, and otherwise exposes
the remaining gap.

The dated private Phase 2 report records actual verification commands, attempts,
mechanical checks, source gaps and remaining semantic limitations. The next
milestone is Phase 3: permissioned source/section windows and better explanatory
evidence selection. Human-labelled business usefulness and broader corpus quality
remain separate work.
