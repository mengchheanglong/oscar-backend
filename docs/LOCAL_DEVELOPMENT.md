# Isolated local development

Use this environment for manual testing on develop. It is separate from the
deployed installation and from the automated test database.

| Component               | Local target                             |
| ----------------------- | ---------------------------------------- |
| Frontend                | `http://localhost:3002`                  |
| Backend                 | `http://127.0.0.1:3001/api/v1`           |
| PostgreSQL service      | Compose `postgres`, loopback port 55432  |
| Development database    | `ai_workspace_develop`                   |
| Automated test database | `ai_workspace_test`, loopback port 55433 |
| Uploads                 | `./var/develop/uploads`                  |

Start only this project's PostgreSQL service with `pnpm db:up`. On the current
machine the separate development database has already been created and all 18
migrations applied. Do not reset it or rerun creation as a cleanup operation.
Future schema changes require explicit migration execution against the local
target. The committed environment template remains a template; the current
machine-specific values live only in the ignored backend `.env`.

The local database URL uses the Compose development role and password, targets
`127.0.0.1:55432/ai_workspace_develop`, and has `DATABASE_SSL=false`. Cloud
Supabase settings are cleared locally and GitHub integration is disabled locally.
The existing DeepSeek configuration and optional Hermes runtime remain available.
Provider calls still use the configured external model service; database isolation
does not make model execution offline.

Start the backend with `pnpm start:prod` after building, or `pnpm dev` when editing
its source. Start the frontend with `pnpm dev`. Verify readiness and the frontend
API proxy before testing. Do not start another process on an occupied port.

## Test account and data

The current local installation contains one real local administrator test account
and one empty AIW development project. No demo users, uploaded deployment files,
project records, reports or prior pending proposals were copied from the deployed
database. The user's credential file is outside the repositories; the same test
email/password work here, with a new local user ID. Initial administrator
bootstrap settings were cleared after provisioning. Use the normal application
to create actual test work and upload the sources you want to use.

After switching databases, log out and sign in again. Sessions from the shared
database are invalid locally. Team shows the authenticated account and active
users sharing at least one project with that account. Removed memberships and
inactive collaborators do not grant visibility. A collaborator's other
collaborators are not automatically visible. This rule also applies to
administrators on Team; the separate system user-management API retains its
administrator permissions. This is a project-collaboration directory, not a
multi-organization tenancy model.

Pending invitations and their links are private to their sender. Only that sender
can cancel an invitation. Members can invite ordinary users; only system
administrators can invite another administrator. Accepting an account invitation
does not automatically add the account to a project. Use the project membership
controls to add a collaborator.

Earlier shared-environment test records were left untouched. This switch performs
no cleanup, rollback or further migration against the deployed database.

## Local MCP

The ignored frontend `.codex/config.toml` now starts a machine-local launcher at
`C:\Users\User\.codex\testing\aiw-local-mcp.cjs`. It validates the local database
target and loads the new local PAT from the ignored backend `.env`, overriding an
inherited deployment PAT only within that MCP child process. Neither credentials
nor this machine-specific launcher are tracked. The global environment and
deployment token were not changed. The launcher calls the existing compiled MCP
server at loopback port 3001.

A fresh stdio client passed project access and accepted-decision queries against
local AIW. The existing Codex connection still holds the former token and returned
401 after the switch; reload Codex/MCP to use the new launcher. Do not claim native
task updates succeeded until the reloaded connection passes authentication.

## Verification - 2026-10-09

All 17 migrations applied to the new local database, with none pending. Login,
single-member Team results and logout passed through the real frontend API proxy.
The local AIW runtime status reports Hermes available. No new model request was
needed for isolation. Dedicated automated PostgreSQL tests passed: three suites,
16 tests. The development database is persistent in the Compose volume; the
automated test database remains separate.
