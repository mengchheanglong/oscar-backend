# Running OSCAR locally

Keep `oscar-frontend` and `oscar-backend` beside each other. Run Compose
commands from `oscar-backend`. Docker Desktop must be running.

The repositories were renamed from Continuum on 18 October 2026. Existing local
folders can retain the `continuum-*` names: set `OSCAR_FRONTEND_PATH=../continuum-frontend`
in the ignored backend `.env` for that layout. The Compose project name remains
`continuum-backend` deliberately so its existing containers and volumes remain
associated with the same application. New image tags use `oscar-backend:local`
and `oscar-frontend:local`; rebuild them with `pnpm stack:up` before app startup.

## Development with Hermes

1. `pnpm db:up` starts PostgreSQL on `127.0.0.1:55432`.
2. In the backend folder, use `pnpm dev`, or `pnpm build` then
   `pnpm start:prod`. The local `.env` sets port 3001 and the isolated
   `ai_workspace_develop` database.
3. In the frontend folder, use `pnpm dev` and open `http://localhost:3002`.

The frontend proxies `/api/v1` to `http://127.0.0.1:3001`. Hermes uses its existing
host Python/runtime paths in the ignored backend `.env`.

## Full Docker app

`pnpm stack:up` builds and starts PostgreSQL, Redis, API, and frontend. The web app
is at `http://localhost:3002` and API at `http://127.0.0.1:3001/api/v1`.
Stop host frontend/backend processes on those ports before starting this profile.
The frontend image builds its API rewrite to the Compose service `http://api:3001`.
Provider credentials are passed to the API through its ignored `.env`; environment
files and machine MCP settings are excluded from image build contexts.

A fresh database needs an explicit migration step:

```
pnpm db:up
docker compose --profile migrations run --rm migrate
pnpm stack:up
```

Normal startup does not run migrations or seed records. Run migrations only
against the intended local database.

The backend image contains the Node API and does not bundle the external Hermes
Python runtime. In Docker app mode Hermes and native host-folder access are
disabled. Use host development mode above for those features. Uploaded documents
and normal Copilot features remain available with the appropriate configuration.

`docker compose --profile app stop frontend api redis` frees the app ports while
leaving PostgreSQL running for host development. `pnpm stack:stop` also stops the
project's database and test container. Both commands preserve volumes.

## Existing local data on this machine

The ignored `compose.override.yaml` reuses the external volume
`ai-workspace-backend_postgres-data` so existing local database records remain
available. It also mounts a host document folder into `/app/var/uploads` for the
Docker API. Keep that bind mount on Continuum's local
`var/develop/uploads` directory so new files stay with this project. If moving
an installation that has existing uploads, copy those files deliberately before
changing the mount; setup must not remove the old folder. Keep the old
`ai-workspace-backend-postgres-1` container stopped while Continuum PostgreSQL
uses that volume. Preserve this volume when maintaining the installation.

On a fresh machine without this override, Compose creates Continuum-owned database
and upload volumes. Keep machine-specific mount paths and credentials untracked.
