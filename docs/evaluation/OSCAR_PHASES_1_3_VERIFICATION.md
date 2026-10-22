# OSCAR Phase 1–3 verification

Date: 19 October 2026. Applies to the uncommitted working trees in the sibling
`oscar-backend` and `oscar-frontend` repositories. These checks include the interrupted
Phase 2/3 work and subsequent review fixes; the Git HEAD alone does not contain them.

## Automated results

| Check                                                 | Result                                                  |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Backend unit and HTTP suites                          | 58 suites, 548 tests passed                             |
| PostgreSQL integration                                | 13 suites, 100 tests passed                             |
| Frontend behavioral regressions                       | 25 tests passed                                         |
| Backend formatting, lint, typecheck, production build | Passed                                                  |
| Frontend lint, typecheck, production build            | Passed                                                  |
| Generated OpenAPI contract                            | Regenerated and repeat generation checked for stability |

The backend HTTP suites use test doubles; PostgreSQL integration suites exercise
real SQL, migrations, lifecycle persistence, review concurrency, and access queries.
Integration runs create and remove their own uniquely named test databases. No
production or development database reset is part of these checks.

Important regressions include revoked project membership, private memory reads by
ID, concurrent reviews, superseded/expired/stale-source recall, goal/project link
validation, archived-project writes, outcome progress versus activity, real calendar
date validation, selected-goal chat context, low-value-work review instructions,
platform token encryption, Paperclip company REST, and local OAuth/PKCE/MCP fixtures.

## Browser acceptance

Signed-in acceptance used synthetic fixtures in a separate generated test database
and an offline model provider. Desktop checks used 1440 × 900; mobile used 393 × 852.

- Project selection remains selected when opening Tasks and Decisions.
- A task and a decision can be created with the same goal and both appear in Linked Work.
- Updating the metric from 20 to 35 of a target of 100 changes measured progress to 35%.
- Goal details, milestones, and initiatives can be edited and persisted with a revision.
  Initiative status can be updated. The goal's project scope remains fixed.
- Goal review opens a fresh chat with the goal-specific prompt and Strategic Review
  mode, and the offline provider completes a turn.
- A goal-scoped memory can be proposed, approved, and corrected. Recall returns the
  approved replacement and excludes the superseded original.
- A T3 connection can be saved and edited. Refreshing an unauthorised connection
  explicitly reports no verified activity snapshot.
- Goal dialogs close with Escape. Common forms use focus trapping and focus return.
  Goals and Platforms fit mobile width without document-level horizontal overflow.
- The production frontend served authenticated pages through the same-origin API
  proxy. No browser application errors were observed in the exercised flows.

Browser findings fixed during acceptance: legacy goal drawer backdrop, bright
legacy review banner, inaccessible goal cards, inconsistent form labels, unavailable
connection editing, and unavailable goal-detail/initiative editing. Local evidence,
logs, source/migration hashes, and verification metadata are stored in ignored
`var/qa/`; they are not published test data or proof of a deployed service.

## Limits

No live paid model calls were made. Prompt grounding and the low-value-work policy
are covered by regressions, but recommendation quality still needs representative
human evaluation with the configured provider. Real Paperclip and T3 installations
were not connected: OAuth and read protocols were verified against local fixtures.
Live authentication, granted permissions, installation versions, and native links
remain deployment acceptance checks requiring the intended credentials.

No Phase 4 execution/dispatch privileges are introduced. Historical API paths,
persisted identifiers, migrations, browser storage keys, and compatibility MCP
names remain supported. No commits, pushes, or deployment are implied by this report.

See the [implementation guide](../product/OSCAR_MAVIS_PHASES_1_3.md) for setup,
naming boundaries, and the implemented lifecycle.
