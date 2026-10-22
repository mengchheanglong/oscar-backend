# Continuum repository split

## Current direction: OSCAR & MAVIS

The [OSCAR & MAVIS vision and architecture](OSCAR_MAVIS_Vision_and_Architecture.md),
supplied on 18 October 2026, is the new product plan. OSCAR is the personal AI Chief
of Staff; MAVIS is the shared memory and continuity subsystem. Continuum remains
the existing engineering foundation. The roadmap starts with preserving and
verifying that foundation before adding goals and cross-platform integrations.
The blueprint itself did not rename repositories, packages, databases, or user data.
The subsequent explicit repository rename is recorded below. Planned capabilities
remain distinct from implemented behavior.

## OSCAR repository rename — 18 October 2026

The user approved renaming the existing private repositories to
[`oscar-backend`](https://github.com/mengchheanglong/oscar-backend) and
[`oscar-frontend`](https://github.com/mengchheanglong/oscar-frontend). Git history,
`main` as the default branch, and `develop` as the working branch are preserved.
Package names, image tags, deployment templates, and current repository links
now use OSCAR. This did not create a separate MAVIS repository or deploy anything.

The local checkouts now use `OSCAR/oscar-backend` and `OSCAR/oscar-frontend`.
The verification script also supports the former sibling-folder layout. On
2026-10-22, the existing local development database was explicitly renamed from
`ai_workspace_develop` to `oscar` in place, preserving its records and historical
migrations. The Compose project and volume identities remain unchanged.

## Repository history

Continuum was separated from AI Workspace on 2026-10-17. Its current product
goal is a personal chat-first workspace for business, finance, research, files,
Kanban tasks, decisions, memory, and Hermes agent work.

The frontend and backend use separate private repositories, with `develop` as
their working branch and `main` as their GitHub default branch. Git history is preserved. No changes are pushed
to the original AI Workspace repositories.

## Local continuity

The local environment files are ignored. On the current machine they use the
existing isolated `oscar` database on 127.0.0.1:55432, frontend
port 3002, and API port 3001. Backend storage paths point to existing local files
to keep current document records readable. User project titles and records have
not been renamed. No database reset, seed, or schema migration is part of the split.

The Compose project is continuum-backend. This machine's ignored Compose override
reuses the existing PostgreSQL volume and documents. Keep the old AI Workspace
PostgreSQL container stopped while Continuum uses that volume. See
[running locally and Docker](../operations/DOCKER_LOCAL.md) for both supported modes.

The original split used Continuum for application branding, API documentation,
and generated MCP labels. The repository/package rename does not by itself
replace those UI/API identities; that is separate Phase 1 work. Legacy API
environment variable names, migration identifiers, browser storage keys, and
internal class names stay compatible with inherited clients and data. Existing
AIW MCP records and historical implementation documents are baseline references.

The inherited deployment templates are setup examples; creating these repositories
does not create or modify any hosted deployment.
