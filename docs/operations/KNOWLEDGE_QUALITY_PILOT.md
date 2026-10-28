# Reviewing knowledge quality

A working index is not evidence of faithful extraction or sufficient teaching
depth. Review faithfulness, completeness, page role and claim support separately.
Use original physical PDF pages, all current page chunks, the exact bounded
model-used excerpts and the saved answer. A preview is not the full indexed page.

## Evidence captured for new turns

Migration `EvidenceSnapshots1793140000000` adds nullable
`ai_messages.evidence_snapshot`. Each new assistant turn retains the bounded
numbered evidence items, including uncited items, exact source body and SHA-256.
`generationAttempted` distinguishes provider attempts from deterministic policy
replies. A failed generation is not an answered question. The snapshot uses the
existing private conversation permissions and is not an additional list of
supporting citations. Historical rows remain null; do not reconstruct them from
current documents. The snapshot is a source-evidence trace, not a full prompt
archive: dialogue, memory, goal context and instructions are separate inputs.

Back up the existing local database before migration. Roll back the application
while retaining the nullable column; the down migration intentionally refuses to
erase historical evidence. Never reset the development database for tests.

## Passage inspection boundary

The authenticated `POST /api/v1/knowledge/passage` proxy signs the current actor
for Knowledge. Search and inspection share current collection, private-reader,
book visibility, approval, generation, revision and exclusion conditions. The
proxy rejects mismatched chunk/document/revision identities, incorrect Unicode
character counts, malformed responses and responses above 100,000 bytes. Errors
log safe codes, not source bodies. Unavailable/excluded passages preserve HTTP
410; stale revisions preserve 409.

The full permitted indexed chunk is not necessarily the whole PDF page. Review
all chunks spanning that page. Full source access also does not prove that a
historical model received it.

## Local pilot records

Installation-specific artifacts live outside Git under
`D:\AI\OSCAR\Knowledge\Catalog\reports\quality-pilot`. Preserve the original
Gemini package and keep corrective findings in a separate directory. The earlier
20 questions are exposed development data, not a held-out benchmark. Freeze new
questions before running them, retain actual app message/request identities,
separate answered/partial/abstained/failed outcomes, and assess all material
claims. Known relevant chunk hits are not precision when other passages remain
unjudged. Do not merge partial support into fully supported accuracy.

Sampled unsafe formulas may be conservatively excluded with the Knowledge
`KNOWLEDGE_QUALITY_EXCLUDED_CHUNK_IDS` setting. Retain a private manifest binding
each exclusion to its original hash, chunk, revision, generation and text hash.
Preserve existing exclusions. This removes entire chunks, including otherwise
useful prose, without repairing them or certifying other pages. Restore only the
previous exclusion list to roll back; never restore an entire old environment
file over new credentials. Recreate the Knowledge API after changing the list.

Page-role judgments in private review reports do not automatically change
retrieval ranking. A bounded pilot cannot establish complete MBA coverage or
corpus-wide extraction accuracy.

## Focused recovery and answer review (2026-10-27)

Focused required-source questions allow up to 3,400 characters per external
item, retaining the overall 16,000-character source budget. Broad learning
overviews retain the shorter allocation. Numeric tables with explanatory prose
are no longer discarded solely because they resemble page-number lists;
explicit navigation signals still apply. This is not table reconstruction or
PDF fidelity verification.

Required-source drafts with current citations receive a second structured call
to the existing generation provider. It reviews every numbered paragraph,
including uncited paragraphs and headings, against all bounded source excerpts.
The reviewer selects numbered source segments; runtime validation resolves
these to original text. Legacy quoted anchors accept only whitespace and
typographic quotation equivalence, never numeric or mathematical rewriting.
Unknown anchors, incomplete block coverage and malformed output fail closed.
An unavailable reviewer withholds the draft with a retry message rather than
claiming the library lacks the answer. Courtesy and deterministic no-evidence
responses do not make this second call.

Unsupported paragraphs are removed. Retained factual paragraphs require source
anchors, retained applications require explicit reasoning labels, and citation
identities come only from the original included evidence. A missing paragraph
marker may be completed after review; irrelevant source identities cannot be
introduced. Scoped source-limit text uses fixed wording. This remains a
probabilistic semantic check: a valid anchor alone does not prove entailment,
and the same provider can repeat its own mistakes.

The existing private JSONB evidence snapshot stores `answerReview`, including
block decisions, original source anchors, reviewer usage and the bounded
unreviewed draft (at most 24,000 characters). No migration is required. This
audit is not displayed as accepted answer text or supporting citations.
Review tokens are included in message totals. There is one additional provider
call for reviewed turns, increasing latency and cost; no cost figure or
independent accuracy percentage is established here. At most 64 blocks and
24 source anchors per block are accepted.

The separate private run is under
`D:\AI\OSCAR\Knowledge\Catalog\reports\retrieval-grounding\2026-10-27`.
Four exposed regressions and eight frozen fresh questions ran through the
signed-in app. The fresh run produced four substantive answers, two partial
answers and two refusals of unsupported requests, with no generation failures.
These are usefulness categories, not fully supported answer accuracy.
Three of six answerable fresh questions included a preselected gold passage;
another used a relevant alternative passage. The hiring limitation page and
systems definition page were missed. Some generalizations also survived review.
The semantic quality gate remains unpassed; do not claim 99% grounding.

All twelve latest turns retained valid source hashes and citation identities
after reload and were excluded from future conversation context. Three earlier
failed development attempts remain preserved separately. The fifteen existing
chunk exclusions remain effective. Next work should separate title/concept/
qualifier search intents, recover missing qualifiers across book fragments,
and evaluate atomic claim review on a new frozen question set. Do not tune on
the eight final questions and then report them as unseen results.

## Sentence review and complementary evidence (2026-10-28)

Review version 2 deterministically partitions the draft into sentence units,
retaining paragraph identities, original text, headings and adjacent citation
markers. The provider must return one decision and explicit entailment, scope,
number/threshold, causal-direction and evidence-status checks per unit. A false
check rejects the unit even if its verdict says supported. A paragraph is kept
only when every unit passes; text is not assembled from disconnected fragments.
A filtered answer reports that some draft material was omitted. Explicit
author-only requests suppress labelled project applications in runtime checks.

The private audit records version 2, sentence granularity, paragraph IDs and
checks. Historical version-1 audits remain intact. Bounds are 64 paragraphs,
128 units, 24,000 draft characters and the existing 16,000 source characters.
This is finer review, not a verified exhaustive decomposition into atomic
claims: a sentence can contain several claims, and the model can still
misjudge them or approve an unsupported application. Conservative paragraph
removal can also discard a useful supported explanation.

Focused required-source questions retain up to three passages per source so
definitions, caveats and examples can coexist. Broad multi-topic plans retain
two; overall retrieval and context budgets stay bounded. Knowledge adds
permission-preserving definition/qualification/direction pools. Role cues and
ranking remain English heuristics, not factual confidence.

The new private round is
`D:\AI\OSCAR\Knowledge\Catalog\reports\retrieval-grounding\2026-10-28`.
The prior final questions are exposed development regressions. New questions
and source expectations were frozen separately; preserve failed attempts and
distinguish internal retrieval or synthetic reviewer tests from signed-in app
evaluation. No new migration, corpus import, reembedding, access expansion or
quarantine removal is part of this continuation.

The first shared-chat run in this continuation is invalid as a clean benchmark:
the test helper excluded only one eligible user turn before each send and left
the previous question in context. Receipts preserve that failure. The unchanged
frozen code was then checked with six separate conversations and database-verified
exclusions between cases. Two replies were substantive with support concerns,
two partial, and two appropriate refusals. These exposed repeats do not establish
held-out accuracy. Supported material can still be removed, and unsupported
recommendation premises or contradictory limitation wording can still survive.
Keep the semantic gate open and preserve these failures for independent review.
