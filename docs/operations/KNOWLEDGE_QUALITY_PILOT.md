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
