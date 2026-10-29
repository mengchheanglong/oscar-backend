# Business usefulness evaluation

Source coverage and mechanically valid citations are necessary but do not certify
business advice. Evaluate retrieval, factual status, reasoning and actionability
separately. The existing `test:assistant-eval` uses synthetic fixtures and a mock
provider; it does not measure real library retrieval or live answer accuracy.

## Project evidence

Maintain a dated project document distinguishing owner-stated direction,
proposed capabilities, measured outcomes, hypotheses and missing evidence. Use
normal authorized document upload and wait for `processingStatus: COMPLETED`.
Do not encode project facts in global prompts or treat an uploaded brief as
permission to change project records. Current owner corrections can update
intent; dated operating evidence is needed to establish performance. Preserve
older records and surface conflicts. This round adds no canonical memory or
automatic fact-update mechanism.

## Live benchmark

Prepare a **private** JSON file with `version: 1` and `cases`. Each case has a
unique safe `id`, `split` (`development` or `reserved`), `question`, and nonempty
`criteria` array. Fix the questions and criteria before development. Use
development questions to diagnose failures. Keep reserved answers unexamined
until code is frozen; if a reserved failure guides a later fix, retire it as a
holdout and add a new question for the next round.

Cover positioning, segment choice, adoption, pricing, unit economics, cash,
experiment design, contradictory signals, unknown market facts, and explicit
book-only scope. Include negative and counterfactual cases. Do not merely ask
questions that reward a higher citation count. Do not upload the benchmark or
generated evaluation answers into the reference library or project evidence.

After building, use a normal human PAT with project membership:

```powershell
# Set OSCAR_API_KEY securely in this process; do not paste or commit it.
$env:OSCAR_PROJECT_ID = 'YOUR_PROJECT_KEY'
node scripts/run-business-eval.cjs --dataset C:/private/benchmark.json --output C:/private/baseline --split development
# After implementing, testing and restarting the local app:
node scripts/run-business-eval.cjs --dataset C:/private/benchmark.json --output C:/private/candidate --split development
node scripts/run-business-eval.cjs --dataset C:/private/benchmark.json --output C:/private/reserved --split reserved
```

The runner uses the real MCP stdio client, local API by default, existing
configured provider, normal source permissions and required-source review. It
creates one private chat per case and saves request identity **before** sending.
Retry the same output directory to reuse the same conversation, request ID and
payload. It rejects changed question/project identities. Use a new directory for
a deliberate new generation. It skips existing receipts; timing excludes skipped
cases. `--case ID` selects one case. It does not automatically retry failed
generation or replay successful requests merely to obtain a better answer.

Outputs must be outside this repository or under ignored `var/`. They contain
private questions, full answers and source snapshots. Protect them accordingly.
The runner does not read credentials from Codex settings, print questions or
service errors, select a different model, change source access, or reset data.
It does not send assessment criteria to the model. Run its five integrity tests
with `node --test scripts/run-business-eval.test.cjs`.

## Mechanical and semantic assessment

Receipts check completion, current citation targets, excerpt hashes, retained
reviewer quote anchors, persisted-message reload and a single message pair. Empty
evidence does not vacuously pass hash/anchor/citation checks. Saved provenance is
auditable but does not establish that a quoted passage entails the claim.

Human-review fields intentionally start `PENDING`; the runner does not invent
semantic scores. Assess each answer against its frozen criteria and record the
reviewer identity, limitations, relevant excerpt and failure reason. An agent's
inspection must be labelled **agent review**, not human sign-off or independent
business validation. Check:

- Retrieval: substantive relevant premises, requested sources and missing topics.
- Support: each material claim, numerical qualification and source attribution.
- Factual status: owner intent, proposed feature, hypothesis and actual result.
- Reasoning: valid bridge, alternatives, uncertainty and contradictory evidence.
- Usefulness: direct answer, practical action when requested, baseline/denominator,
  proposed observation window and decision rule appropriate to the question.

Compare the same questions before and after changes. Report refusals, missing
sources, unsupported recommendations and filtering that removes necessary parts,
not only completion and elapsed time. Reserved runs remain small, correlated,
single-generation samples, not a library-wide accuracy estimate. A same-model
support reviewer is not independent validation. Human field feedback and actual
business outcomes remain necessary.

## Guidance and limitations

Conditional business guidance asks for source premises, a locally labelled
recommendation, alternatives and a practical test when requested. It preserves
short pitches and source-only explanations. Numerical review v9 explicitly
checks zero-profit versus target-profit, units, nonpositive contribution,
cash-versus-profit, causal attribution and proposed versus measured thresholds.
These are model instructions and existing fail-closed claim checks, **not a
deterministic financial calculator or guaranteed causal diagnosis**.

Requested source-checked alternative hypotheses remain eligible only as labelled
hypotheticals, with advice scope and all existing claim checks. They cannot pass
as empirical diagnoses. Advice intent includes "what we can do next" and ignores
requests embedded in attached-source text. When supported material survives a
review that also identifies a source limit, a fixed, scoped gap notice stays
visible. The model's raw absence claim is still withheld; the notice cannot
assert that the whole library or every company record lacks a fact. A gap alone
does not authorize publishing unsupported advice. Unavailable reviews record a
safe schema/coverage/unavailable code without private exception text.
Explicitly requested numbered interview questions are reviewed together with
their rationale as atomic proposed-question blocks. This prevents sentence
filtering from detaching quoted questions, numbers and explanations. Source
anchors, claim checks and scope still apply; no unsupported wording is restored.

Explicit concept enumerations can trigger bounded synthesis searches even
without the words "books" or "principles". Concepts come from the user request,
not a fixed business taxonomy or attached instructions. Named-source precedence,
shared search deadline, access controls and model/embedding identities remain.
This English heuristic can miss other phrasing and does not establish exhaustive
library coverage, full chapter expansion or completed semantic graph work.
