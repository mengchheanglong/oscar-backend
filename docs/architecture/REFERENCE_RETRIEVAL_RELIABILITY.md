# Reference retrieval and cross-source reasoning

This improvement preserves the configured provider/model, embedding identity,
source permissions and required-source answer policy.

## Planning and evidence

- Explicit named-book synthesis searches each requested book before the broad
  anchor. Execution shares the existing installation deadline fairly; output
  selection still interleaves original plan positions and preserves source caps.
- For unnamed synthesis, a short enumeration after connect/combine/integrate or
  relationship between yields up to three concept searches drawn from the user's
  own words. It does not assign every question to a fixed business taxonomy.
- A long first question followed by supported answer-format instructions can use
  just that first question for search. The complete original input and constraints
  remain model input. Substantive second questions are retained.
- Required-source general retrieval now persists `reference-plan` audit metadata
  alongside existing `business-aspects` audits. Timings, query character counts,
  candidate IDs, selections and deadline status are recorded without raw queries.
- An explicit no-application request excludes project/attachment evidence,
  project instructions, saved memories and goals from the assembled reference
  context. It cannot substitute project records for unavailable book evidence.
  Existing conversation history is still subject to its separate context policy.

## Support review v6

Advice intent recognizes questions such as "How should ExampleShop ...".
Requested synthesis can retain explicitly labelled reasoning bridges and
conditional implications; requested advice can retain decision gates. Source
anchors, claim checks, scope and observed-versus-proposed checks remain required.
No label makes an unsupported assertion acceptable. Explicit no-application
requests also reject project-source substitution during review.

Closing Markdown emphasis is attached to its preceding sentence before filtering.
Tables are reviewed as atomic blocks, avoiding publication of fragmented rows.
This preserves structure rather than silently approving rejected content.

## Evaluation limits

The local baseline returned no reference evidence for the three diagnostic
questions. Corrected live questions retrieve book evidence, including all three
explicitly named authors. A narrower first revision answered pricing faster but
missed the accounting definition; concept searches restored that source at a
latency cost. Do not present intermediate speed as the final latency result.
Raw attempts, elapsed times, saved-message checks, excerpt hashes and reviewer
anchors are in the private dated report. They are diagnostic examples, not
held-out accuracy or recall estimates. Same-model review is not independent
semantic verification, and numerical assumptions still need human inspection.

Rollback uses the previous code revision and rebuild/restart; no source reimport,
database reset, vector migration or schema downgrade is needed.
