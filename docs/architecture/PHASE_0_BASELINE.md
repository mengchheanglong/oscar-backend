# Knowledge intelligence Phase 0: reproducible baseline

Phase 0 prepares measurement and preservation for the
[knowledge intelligence roadmap](KNOWLEDGE_INTELLIGENCE_ROADMAP.md). It does not
implement typed calculators, change retrieval ranking, enrich the graph, clean
PDF pages or claim business-answer correctness.

## Preserved configuration and data

Reconcile documentation with the explicit installation configuration before
benchmarking. Preserve generation/embedding models, revisions, vector identities,
source access, exclusions and active generations. Record allowlisted configuration
values and secret-file hashes rather than credentials. Never log complete `.env`
files or copy credentials into Git.

Create consistent database archives before app evaluation. Check archive decoding
and hashes and report whether an actual restore test was performed. Database
archives do not include original PDFs or uploaded filesystem assets. Record
source/canonical-manifest fingerprints separately and label sampled source checks
as samples, not full-library audits. Keep all backups, private grants and source
paths outside Git with appropriate local access controls.

The established local runtime uses DeepSeek Flash for generation and pinned
Qwen3-Embedding 0.6B/1024 through Ollama. Pro and OpenAI remain explicit alternatives;
this documentation reconciliation does not switch any model. Verify the installed
digest against both service configurations. Separate a cold model warm-up from
warm query samples; never download a replacement merely because the configured
runtime is unavailable.

## Frozen question sets

Prepare 40 development and 20 reserved cases with unique IDs, task categories and
predeclared assessment criteria. Save dataset hashes before running any answers.
The prior consumed twenty-case suite remains regression material.

Run only development cases in Phase 0. Keep reserved files out of generation,
runtime prompts, source ingestion and live evaluation. Before the next release
check, verify their hashes and run them only after freezing the candidate. Any
reserved case used to tune a fix becomes a consumed regression case.

Question criteria and agent-selected source anchors are not independent human
ground truth. Record reviewer identity and pending human review. Do not turn
agent judgments or a model's support verdict into a measured accuracy percentage.

### Important: a new chat is not an isolated evaluation

The existing history repository can recall eligible conversations in the same
project/user scope. Automatic history indexing can also be enabled explicitly.
Do not assume that a fresh conversation has no older conversational context.
Do not change the user's ordinary history configuration to make results look
cleaner or silently erase existing history.

Keep the ordinary-project diagnostic as a measurement of the current app. For a
source-controlled comparison, use a dedicated owner-accessible evaluation project
with only the intended source documents and no normal business history/memories.
Before each case, verify there are no eligible completed test messages. After
capturing the answer and reload receipt, call the normal scoped API:

`POST /projects/:projectId/ai/conversations/:conversationId/messages/:messageId/exclude-context`

Exclude both synthetic message roles, preserving transcripts. Verify exclusion,
zero eligible messages and zero cross-conversation dependencies before the next
case. Normal exclusion invalidates affected summaries and history vectors; do not
replace it with direct database updates. A control with fewer project documents
is not identical to the ordinary project: record that difference and do not
attribute all performance/answer changes to isolation alone.

If cleaning newly generated ordinary-project diagnostics, restrict cleanup to
their exact recorded IDs and unchanged two-message transcripts. Inspect dependency
closure first; stop rather than excluding unrelated user conversations. Old
evaluation material and normal user conversations require separate scoped review.

## Duration-only assistant instrumentation

New replies may have an optional `evidenceSnapshot.stageTimings` object:

```json
{
  "version": 1,
  "turnElapsedMs": 12345,
  "stagesMs": {
    "referenceRetrieval": 5100,
    "projectRetrieval": 250,
    "contextPreparation": 40,
    "evidenceAssembly": 2,
    "conversationContext": 300,
    "generation": 2600,
    "supportReview": 3900
  }
}
```

These are illustrative numbers. Stage names are fixed and values are durations
only; no prompt, source text, credentials or raw provider output is added to logs.
Existing private evidence-snapshot access rules continue to apply.

- `referenceRetrieval`: whole permitted external-retrieval operation, including
  its embedding/search/graph work. Existing per-search audit metadata provides
  additional query timing. This is not isolated SQL execution time.
- `projectRetrieval`: existing project retrieval operation, overlapping reference
  retrieval. **Do not sum concurrent durations to estimate end-to-end latency.**
- `contextPreparation`: attachments, inventory, memories, goals and MAVIS context
  preparation after project search; excludes waiting for reference retrieval.
- `evidenceAssembly`: selection/assembly and prompt preparation, including an
  existing platform lookup if that question triggers it.
- `conversationContext`: existing conversation preparation/compaction work.
- `generation`: existing answer-generation branch, which can instead produce a
  deterministic source-policy reply. Check `generationAttempted` before treating
  this as a model call.
- `supportReview`: the existing review when invoked. A missing duration means the
  stage did not run or was not captured, not zero cost.
- `turnElapsedMs`: monotonic elapsed time inside the locked turn, ending before
  the final message commit. It excludes lock waiting, final persistence, HTTP/MCP
  and client overhead. The live runner's elapsed time covers request and saved
  message reload and is a different measurement.

Historical replies may have no timing object. Idempotent replay returns the
original saved reply and timings rather than measuring another generation.
Generation failures retain measured stages when the failure reply is persisted;
errors occurring before a captured answer do not have a fabricated stage trace.

This instrumentation adds private JSON audit metadata without a database
migration or changed generation instructions. It does not assert that a stage
was semantically successful simply because its duration was recorded.

## Baseline run and reporting

Use the existing real MCP runner and normal human project membership. Generate one
initial answer per development case, sequentially, with the existing provider.
Keep the initial failures, source-review status, original source hashes, citation
checks, stage timings and persisted-message reload checks. Do not silently repeat
an answer to improve its score or hide a slow run.

Record runtime build hashes and external service state before running. Finish
heavy local tests/backups before latency sampling; record uncontrolled host load
as a limitation. Measure nearest-rank p50/p95/max and report sample size, task
mix, unavailable reviews and failed requests. Do not compare this mixed sample
with a narrower historical sample as proof of faster performance.

Semantic inspection should identify phase-1/2 failures with original evidence,
not fix them during baseline collection. Mechanical provenance can pass while a
number, causal inference or requested artifact remains wrong.

Afterward, recheck configuration hashes, catalog/grant fingerprints, unchanged
library counts, sampled source hashes and reserved-set hashes. New private
evaluation chats are expected main-app writes; they do not establish unchanged
database row counts or new business evidence. No benchmark answer is uploaded
to the reference or project-document index.

Phase 0 is ready for handoff when preservation receipts, actual configuration,
frozen datasets, reproducible development results, timing definitions, observed
failures and known limitations are recorded. Phase 1 then implements numerical
validation against that baseline.
