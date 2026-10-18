# Project chat preferences

The chat-first frontend uses shared project preferences and private conversation
metadata. This extends the existing project, document, membership, and conversation
services without adding a second storage system or changing AI providers.

## Contract

- Project create/update accept nullable `icon` (32 characters) and `instructions`
  (4,000 characters). Responses expose both. Updates retain project role,
  archived-project, CSRF and optimistic-version checks. Empty values normalize to
  null. Preferences belong to the project and are visible to its members.
- `PATCH /api/v1/projects/:projectId/ai/conversations/:id` accepts `title`
  (trimmed, 1–200 characters) and/or `isPinned` (boolean). Null, blank titles,
  unexpected fields, wrong types and overlong values fail validation.
- Conversation responses expose `isPinned`, default false. List/get/update remain
  scoped by project, author and nondeleted status. Another project member cannot
  rename, pin, or discover another author's conversations. The endpoint updates
  only metadata, preserving concurrent history/context fields.
- Saved project instructions are supplied to both ordinary Assistant and Hermes
  context assembly, bounded to 4,000 characters. They are preferences and cannot
  grant tool permissions, override grounding, or authorize unreviewed mutations.
  All Workspaces answers do not apply an arbitrary project's shared instructions.

## Migration and local verification

Run migration `1792368000000-ProjectWorkspacePreferences` explicitly. It adds
nullable project icon/instructions and a false-default, nonnullable conversation
pin column. Synchronization and automatic migrations remain disabled.

Verified: lint/typecheck/build, 348 unit tests, 156 HTTP tests, 79 PostgreSQL tests,
OpenAPI generation and format check. New cases cover metadata validation,
CSRF, same-project author isolation, project privacy/version conflicts, nullable
preference clearing, instruction bounds, and real database persistence/defaults.
Tests use the dedicated database on loopback 55433. The development migration was
applied only after asserting `ai_workspace_develop` on `127.0.0.1:55432`.

Browser checks exercised file/folder project creation, persisted chat rename/pin,
project icon/rename, instruction saving without clearing a draft, membership
controls, archive/restore and the mobile panel. Synthetic QA projects and stored
files were removed. External cloud connectors, automations, permanent project
removal and model-behavior evaluations are outside this change.
