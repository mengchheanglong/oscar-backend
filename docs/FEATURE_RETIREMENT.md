# Continuum feature retirement — 2026-10-18

Continuum's current workspace features are Chat, Global search, Decisions, Tasks,
Files, and Knowledge (coming soon), with projects, personalization, membership,
integrations, and agent execution supporting those workflows.

## Removed functionality

- Meetings and Requirements: controllers, services, DTOs, entity mappings,
  frontend pages, API client methods, creation/linkage controls, search types,
  ingestion handlers/extractors, and MCP tools/resources.
- Meeting analysis and requirement-based task proposals, including editing or
  confirming old pending proposals from those features. Historical proposals and
  their results remain stored. Decision-based task proposals retain human review,
  source revision checks, permissions, and idempotency.
- Dashboard aggregates and its activity endpoint. The old frontend dashboard URL
  remains a compatibility redirect to Chat.
- Duplicate frontend project interfaces. Project links open the current project
  settings panel; `/projects` redirects to Settings → Projects. Project access
  management remains available there. The `/users` compatibility redirect to Team
  settings remains because user accounts and memberships are still active features.

Hermes `request_task_review` now takes `decisionId` rather than `requirementId`.
It validates the decision's project and revision before persisting a reviewable
proposal. It still cannot directly create a task.

## Existing data and rollout

No migration or data deletion is required. Existing meeting/requirement tables,
revisions, foreign keys, and historical migrations remain unchanged. Nullable
legacy IDs on tasks/decisions are retained internally for database compatibility,
but are no longer accepted or exposed by their HTTP DTOs. The shared task priority
enum now lives in `src/common/enums/priority.enum.ts`.

Previously indexed meeting/requirement sources are excluded from keyword,
semantic, and fallback retrieval, chat inventory, source listing/detail/reindex,
and active search APIs. Old chat text is preserved; its retired citations show an
unavailable message in the frontend. Historical enum values remain internal so
stored records can still be read safely. Backup tooling continues to include the
retired tables.

Deploy frontend and backend together: removed routes return 404 and removed
linkage/filter fields are rejected by DTO validation. Use a fresh compiled output
directory or fresh Docker image so deleted entity mappings cannot survive in
stale generated JavaScript. Restart MCP clients to refresh tool discovery.

## Verification

- Backend: lint, typecheck, build, formatting, OpenAPI regeneration, 310 unit
  tests, 126 HTTP tests, and 82 PostgreSQL integration tests passed.
- Frontend: lint, typecheck, production build, and all 19 regression tests passed.
- Integration tests used only the dedicated `_test` database on port 55433.
  A new regression verifies retained retired sources cannot enter retrieval.
- Local production-build browser checks covered current navigation, sidebar
  project settings, compatibility project links, and project access controls.
  Synthetic QA records were removed afterward; no model calls were needed.

The first database run exposed a timeout in the new setup hook. Increasing that
hook's timeout prevented setup from overlapping the following suite; the complete
suite then passed. No schema reset was used.
