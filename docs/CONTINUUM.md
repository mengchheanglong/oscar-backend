# Continuum repository split

Continuum was separated from AI Workspace on 2026-10-17. Its current product
goal is a personal chat-first workspace for business, finance, research, files,
Kanban tasks, decisions, memory, and Hermes agent work.

The frontend and backend use separate private repositories, with develop as
their working/default branch. Git history is preserved. No changes are pushed
to the original AI Workspace repositories.

## Local continuity

The local environment files are ignored. On the current machine they retain the
existing isolated ai_workspace_develop database on 127.0.0.1:55432, frontend
port 3002, and API port 3001. Backend storage paths point to existing local files
to keep current document records readable. User project titles and records have
not been renamed. No database reset, seed, or schema migration is part of the split.

The Compose project is continuum-backend. This machine's ignored Compose override
reuses the existing PostgreSQL volume and documents. Keep the old AI Workspace
PostgreSQL container stopped while Continuum uses that volume. See
[running locally and Docker](DOCKER_LOCAL.md) for both supported modes.

Public application branding, package names, API documentation, generated MCP
server labels, and deployment template service names use Continuum. Legacy API
environment variable names, migration identifiers, browser storage keys, and
internal class names stay compatible with inherited clients and data. Existing
AIW MCP records and historical implementation documents are baseline references.

The inherited deployment templates are setup examples; creating these repositories
does not create or modify any hosted deployment.
