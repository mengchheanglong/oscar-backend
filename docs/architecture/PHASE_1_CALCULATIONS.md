# Phase 1: bounded deterministic business calculations

Implemented on 2026-10-30 against the knowledge intelligence roadmap. This is a
calculation checkpoint, not completion of the intelligence architecture or a
financial planning system.

## Runtime path

1. Detect an explicit calculation or supported numerical metric request.
   Conceptual explanations without sufficient amounts stay on the ordinary
   source-reviewed answer path. Word-count instructions are not business inputs.
2. Use existing permission-filtered reference/project retrieval unchanged.
3. Tokenize bounded decimal amounts and simple number words from the current
   request. Record original offsets, literal, context, units, currency and period.
   Mark supplied amounts hypothetical or user-provided/unverified. Do not extract
   project inputs from historical conversations or pasted `SOURCE` blocks.
4. Ask the configured generation provider for a strict operation/field-to-ID
   mapping and original method quotations. This call does not calculate or write
   business records. Normal qualitative questions do not acquire this extra call.
5. Validate the finite plan, known IDs, role hints, dimensions, currency/period
   compatibility, discrete counts, complete cost components and denominators.
   Overlapping requests are rejected rather than publishing contradictory totals.
6. Calculate with bounded exact BigInt rational arithmetic. Render controlled
   text and original method quotes; do not ask a model to rewrite the numbers.
7. Persist the calculation audit in the assistant message's existing private
   JSONB evidence snapshot. Existing project/user authorization and stable
   client-request replay remain in force. No new database or migration is needed.

## Supported operations

| Operation          | Inputs and behavior                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Unit economics     | Price minus total variable cost; contribution ratio; optional fixed costs and target-profit units                                   |
| Labor economics    | Minutes/hours times hourly/minute rate, plus an explicitly supplied remaining-variable-cost total; optional contribution/break-even |
| Fixed sales mix    | Exactly two tiers and positive counts per fixed bundle; round complete bundles upward                                               |
| Cohort/subset rate | Supplied numerator divided by original denominator; subset/count checks                                                             |
| Percentage change  | Before/after absolute and relative change; compatible units and nonnegative baseline                                                |
| Funnel comparison  | Orders and visits before/after, order growth, conversion, percentage points and relative conversion change                          |
| Simple runway      | Cash balance divided by constant net burn with an explicit burn period                                                              |
| Cash balance       | Opening cash plus stated inflows minus stated outflows                                                                              |
| Scenario total     | Discrete quantity times unit price                                                                                                  |

Decimal displays round half-up to at most six places; exact fractions are saved.
Required whole units/bundles round upward. Zero denominators have an explicit
undefined notice. Nonpositive contribution cannot cover positive fixed costs by
adding volume. A zero-volume/zero-fixed-cost corner case does not imply viable
positive-volume economics. Nonpositive net burn supplies no finite depletion time
under the constant-flow model and does not guarantee future cash sufficiency.

Other variable costs cannot substitute for total variable cost. Missing costs are
not zero. Mixed currencies have no automatic exchange-rate inference; mixed
periods have no automatic annual/monthly conversion. Unsupported notation (such
as abbreviated magnitudes, percentages as count inputs, leading-dot amounts or
ambiguous OCR) asks for normalized inputs. The initial input language/role hints
are English; this does not certify arbitrary multilingual financial extraction.

## Receipt and source policy

`evidenceSnapshot.calculationAudit` records operation/version, input literals and
offsets, question hash, assumption status, conversion/formula steps, outputs,
exact fractions/rounding, notices, validation/errors and original source quotes.
It also records extraction model and token usage. It remains available through
the authenticated assistant/MCP message APIs, including reload and replay.
There is no dedicated calculation-receipt screen in this phase.

`generationAttempted` describes answer drafting. Typed extraction is separately
recorded in `calculationAudit`; `oscar-calculator-v1` is the deterministic answer
producer, not a replacement LLM. The configured DeepSeek model and pinned Qwen
embedding identity are unchanged. A duration-only `calculation` stage separates
mapping/validation time from answer generation and reference retrieval.

Published principles must be original substrings of permitted external reference
passages, allowing only the existing whitespace/typographic quote normalization.
Review-required sources are excluded from this path. Operation cue checks are
heuristics, not independent semantic certification. A cited principle does not
mean the author supplied or endorsed the user's numbers, every derived step, or
the business conclusion. Controlled arithmetic replies do not run the prose LLM
support review; qualitative replies retain it.

When sources are required, an absent validated method quote withholds numerical
publication with a source-gap notice, even when a correct private calculation
receipt exists. Mapping/provider failures do not fall back to unchecked model
arithmetic. Clarifications and source gaps may have no citations because they
make no numerical business claim. Current-user amounts remain unverified;
neither exact arithmetic nor a citation establishes demand, profitability,
feature readiness or causality.

## Verification and limits

Tests cover the roadmap examples, exact decimal behavior, upward rounding,
zero/negative contribution, missing cost components, mixed units/currencies/
periods, zero denominators, invalid counts, invented IDs/operations/quotes,
component-as-total substitution, overlapping requests, safe publication and
persisted/replayed assistant behavior.

Verification passed: 656 unit tests, 178 HTTP tests, six runner checks,
lint, typecheck, formatting, build and OpenAPI generation. Live diagnostics
retain 29 attempts: nine initial frozen-development cases, nine corrected
re-runs, nine additional acceptance diagnostics and two final-runtime checks.
The 20 post-correction cases completed and reloaded consistently. This counts
responses, including source gaps and clarifications, not successful business
answers. Correct arithmetic can remain unpublished under the source policy.

The private dated Phase 1 report retains first attempts and subsequent runs on
selected frozen **development** cases. Each diagnostic conversation is excluded
from recall through the normal API before the next case; its transcript remains.
The reserved set is untouched. Mechanical provenance/reload checks are separate
from human relevance/support judgments and are not accuracy scores.

Live testing found a component-as-total error in the first labor attempt. Added
runtime rejection and a regression test; the corrected calculation is accurate.
The unchanged retrieval path still returned exercises rather than a suitable
principle for that frozen question, so the corrected response withholds its
numbers. This is an open retrieval-quality limitation, not a passed end-to-end
business-answer case. Other selected cases publish sourced unit economics,
sales mix, cohort churn and funnel arithmetic.

The next milestone is Phase 2: preserve requested answer parts, diagnose
post-review omissions and provide bounded repair without restoring unsupported
claims. Phase 3 addresses explanatory source/section retrieval. The calculator
does not solve arbitrary implicit arithmetic, general forecasting, accounting
compliance, multiple scenarios sharing inputs or source-quality auditing.
