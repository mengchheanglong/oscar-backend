# History retrieval evaluation — 2026-10-16

Real `openai/text-embedding-3-small` vectors were obtained through OpenRouter at
1,536 dimensions. The harness used temporary synthetic users/projects in the
dedicated PostgreSQL test database. No original user chats or generation requests
were part of this evaluation. Fixtures were removed after each run.

## Results

| Split/policy               | Keyword cases passed | Hybrid cases passed | Forbidden results |
| -------------------------- | -------------------- | ------------------- | ----------------- |
| Calibration, distance 0.35 | 5/8                  | 5/8                 | 0                 |
| Calibration, distance 0.65 | 5/8                  | 7/8                 | 0                 |
| Held out, distance 0.65    | 4/8                  | 7/8                 | 0                 |

The cutoff was selected from calibration distances. Held-out wording was evaluated
after freezing the cutoff; it was not used for further tuning. There are only
eight cases in each set, so these are development checks, not a statistically
representative production benchmark.

| Held-out case               | Keyword    | Hybrid                         |
| --------------------------- | ---------- | ------------------------------ |
| Exact wording               | Pass       | Pass                           |
| English paraphrase          | Miss       | Pass, relevant message rank 1  |
| Thai query / English source | Miss       | Miss                           |
| Simulated older fact        | Miss       | Pass, relevant message rank 1  |
| Corrected fact              | Miss       | Pass, corrected message rank 2 |
| Excluded source             | No results | No results                     |
| Deleted source              | No results | No results                     |
| Unrelated question          | No results | No results                     |

On the five positive held-out cases, relevant-message recall within six results
was 1/5 for keyword search and 4/5 for hybrid. Both returned no results on the three
negative cases. Foreign-user/project fixtures were present and never selected.
The correction case retrieves the new fact alongside earlier material; this does
not demonstrate that a generated answer resolves the conflict correctly.

## Latency and usage

Held-out keyword retrieval took about 6–18 ms per query in this tiny corpus.
Hybrid took about 1.16–1.26 seconds, including an external query embedding. These
single-run measurements are not a production latency guarantee or scale benchmark.

The held-out run used 11 embedding requests covering 18 texts and 725 input
characters. The provider reported 184 embedding tokens. The chosen calibration
run used 11 requests and 160 tokens. Two earlier distance-0.35 runs also reported
160 tokens each. A separate compatibility probe reported six tokens; an initial
model-alias rejection may have incurred provider usage that was not retained.
These records are not a complete billing ledger, and no currency cost is inferred.

Ignored raw reports include:

- `test-results/history-recall-eval-1792108545304.json` — first distance-0.35 run.
- `test-results/history-recall-eval-1792108620993.json` — calibration distances.
- `test-results/history-recall-eval-1792108748848.json` — chosen calibration policy.
- `test-results/history-recall-eval-1792108862581.json` — held-out evaluation.

## Remaining work

Expand the corpus with realistic long messages and varied languages, add an
independent larger validation set, and evaluate final answer correctness and
conflict resolution. The first-900-character vector format can miss later passages.
Model-dependent distance calibration and automatic budgeted indexing of new
messages also need further product work. Exact search remains the baseline;
no approximate index is justified by this corpus size.
