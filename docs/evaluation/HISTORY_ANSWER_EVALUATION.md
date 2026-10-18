# English history answer evaluation

Evaluated on 2026-10-16 using the configured DeepSeek V4 Pro generation adapter
and normal OpenRouter embeddings. This exercises the real `AiService.postMessage`
path inside a Nest application context against a dedicated PostgreSQL test
database. It is separate from the earlier retrieval-only benchmark.

## Measured result and correction

The initial run passed **9/10** scenarios. Both competing user statements reached
the prompt in the later-chat correction case, but the answer was `UNKNOWN` instead
of the newer value. Search rank did not convey which statement was saved later.
It did not leak a forbidden value or answer with the old value in that run.

History queries now return the canonical saved-message sequence with each excerpt.
Selection still ranks relevance; context presentation sorts the selected excerpts
by saved order. The system prompt and historical-data boundary explain that higher
sequence numbers mean later records, that later user statements can update the same
personal detail, and that assistant suggestions do not establish user choices.
The prompt receives only relative positions within the selected set; global
database counters and gaps stay server-side to avoid exposing other tenant activity.
The metadata does not grant permissions or establish verified project facts.
The existing byte budget includes the extra metadata and instruction text.

After the fix, a fresh-fixture replay passed **10/10**, with no forbidden-value
mentions or invented citations. This is a small deterministic-value evaluation,
not a general accuracy score or proof of ChatGPT parity.

| Scenario                        | Initial       | After fix | What is exercised                                                            |
| ------------------------------- | ------------- | --------- | ---------------------------------------------------------------------------- |
| Early fact in the same chat     | Pass          | Pass      | A chosen label remains available after 14 unrelated exchanges                |
| English paraphrase across chats | Pass          | Pass      | Alert preference is retrieved and used in an answer                          |
| Current-message correction      | Pass          | Pass      | The current user's updated value overrides an older retrieved value          |
| Later-chat correction           | Fail: UNKNOWN | Pass      | Two otherwise equivalent statements are resolved using saved order           |
| Assistant suggestion            | Pass          | Pass      | A suggested label is not treated as a user's choice                          |
| Excluded fact                   | Pass          | Pass      | Previously indexed then excluded content is unavailable to a fresh answer    |
| Other owner, shared project     | Pass          | Pass      | Another member's private value is unavailable                                |
| Other project, same owner       | Pass          | Pass      | All Workspaces does not broaden private-history access                       |
| Updated reviewed preference     | Pass          | Pass      | An edited saved currency preference replaces the prior version               |
| Recall after compaction         | Pass          | Pass      | A forced summary preserves an early label and a durable summary is committed |

The compaction scenario uses a process-local 16,000-unit byte-based context budget,
30 unrelated exchanges and one actual summary call. The configured development
budget remains unchanged. This is a compaction exercise, not years of real usage
or a process-restart test. Preference recall is tested; broad personalization of
writing style or behavior is not measured here.

## Reproduce safely

Start and migrate the dedicated test database using the documented integration
test workflow. Keep `TEST_DATABASE_URL` distinct from the development URL and use
a database name ending in `_test`. Then run:

```powershell
pnpm exec ts-node scripts/evaluate-history-answers.ts --live --confirm-provider-cost
```

For a targeted recheck, use the frozen scenario name:

```powershell
pnpm exec ts-node scripts/evaluate-history-answers.ts --live --confirm-provider-cost --only=later_chat_correction
```

The script requires the existing DeepSeek V4 Pro and separate embedding settings.
It overrides database/worker/bootstrap settings only inside its own process:
automatic indexing, Hermes, GitHub and initial-admin provisioning are disabled.
It does not write `.env`, start an HTTP listener, or use saved login credentials.
Each scenario creates synthetic owners, projects and dialogue, then removes only
its own records in `finally`. Case errors are reported safely and cleanup restores
the temporary context budget. No development conversations are copied.

The fetch boundary permits only the configured generation and embedding endpoints,
and rejects oversized requests before networking. Per-run ceilings are:

| Workload                                    | Ceiling |
| ------------------------------------------- | ------: |
| Generation requests, including summaries    |      14 |
| Generation message input, UTF-8 bytes       | 200,000 |
| Reserved generation output tokens           |  42,000 |
| Output tokens requested per generation call |   3,000 |
| Embedding requests                          |      40 |
| Embedding input texts                       |     128 |
| Embedding input, UTF-8 bytes                | 100,000 |

Attempts are counted before sending, including failed requests. These ceilings
bound workload rather than currency cost. Every run requires the explicit cost
flag. The script stores reports under ignored `test-results/` and exits nonzero
for a failed case or a reached network ceiling. Do not treat fixture/scorer tests
with scripted failures as a live quality measurement.

Grading checks a chosen synthetic value or `UNKNOWN`, rejects stale/foreign value
mentions and citations, and requires a completed response. Markdown around a code
is allowed. A small affirmative phrase whitelist is accepted separately from
single-code formatting; mere token presence, negation and uncertain alternatives
do not pass. No model judge or hidden reasoning is collected. Reports contain
synthetic answer text, context-size/count diagnostics and scalar usage, never keys,
raw prompts, vectors, or provider reasoning.

## Observed usage and limitations

| Metric                              | Initial run | After-fix replay |
| ----------------------------------- | ----------: | ---------------: |
| Answer/summary requests             |          11 |               11 |
| Generation input bytes              |      61,740 |           70,382 |
| Provider-reported prompt tokens     |      12,662 |           14,142 |
| Provider-reported completion tokens |         108 |               87 |
| Embedding requests / texts          |     21 / 23 |          21 / 23 |
| Embedding input bytes               |       3,130 |            3,130 |
| Provider-reported embedding tokens  |         672 |              672 |

Both runs stayed below every ceiling. The ignored raw reports are
`history-answer-eval-1792111612633.json` and
`history-answer-eval-1792111854938.json`. Each used ten answer calls and one summary
call; the separate automatic-indexing ledger was not used by these explicit tests.
No currency cost is inferred from token counts.

A final targeted live recheck after projecting the canonical order to relative
positions also passed the later-chat correction. Its report is
`history-answer-eval-1792112272191.json`: one generation request, 1,208 prompt
tokens, two completion tokens, and three embedding requests/four texts with 97
reported embedding tokens. The complete ten-case replay preceded this final
metadata projection; the targeted recheck validates the changed correction path.

These are ten artificial English scenarios with short expected answers. The replay
is a regression check of the same scenarios, not an independent holdout. Temporal
reasoning involving effective dates, historical retellings, long messages beyond
the 900-character embedding head, more than six competing retrieved excerpts,
summary-versus-history conflicts, free-form answers, tool execution and broad
personalization need further evaluation. Saved order is not a verified real-world
event date. Cross-language work is deferred per the user. HTTP authorization,
browser behavior and production capacity are not established by this harness.
