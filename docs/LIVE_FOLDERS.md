# Live local source folders

In Documents on the local Windows desktop, choose **Add folder** to open the
native Windows folder chooser. Select a directory and choose **Connect folder**.
Cancelling creates no grant. On unsupported systems or chooser failure, manual
path entry remains available. In AI Copilot, open **Agent work** to have Hermes discover,
search and read relevant files. Connecting saves only the folder grant, not file
contents. File changes are visible on the next tool read without rescan/indexing.

## Local setup

Use the isolated development database and ports in [Local development](LOCAL_DEVELOPMENT.md).
Set `LOCAL_FILES_ENABLED=true` in the ignored backend `.env` and restart it.
Install ripgrep so `rg` is available on the backend process PATH. Availability
reports configuration, not a successful ripgrep probe. This capability is disabled
by default, requires a loopback HOST, and is disabled in production. No schema
migration or deployment configuration change is needed.

Only the local system administrator can connect folders. The app's isolated tester
is provisioned as that administrator. Grants are private to the connecting user
and project; shared project members do not inherit them. Active membership and
account status are rechecked for every tool. Drive roots and network paths are
rejected. Traversal and symlink/junction paths cannot be read. This is intended for
a trusted local computer, not a sandbox against another process that can mutate
its filesystem or registry.

`LOCAL_FILES_REGISTRY` defaults to `./var/local-folders.json` in the backend.
Keep this machine-local file untracked. It contains grants and absolute paths,
with atomic serialized writes within one backend process. Do not share one registry
across multiple backend instances. Disconnect revokes future access and never
modifies original files. Saved run reports and historical excerpts remain.

## Tools and limits

- `list_local_folders`: private grant IDs/names; no absolute paths given to Hermes.
- `list_local_files`: name filter and stable sorted pages of 100 paths.
- `search_local_files`: literal ripgrep content search, 50 matches per page, up to
  two matches per file. Search follows Git ignore rules, excludes common
  dependency/build folders and credential names, and does not follow symlinks.
  It searches text directly; PDF/DOCX content needs a file read.
- `read_local_file`: relative paths only, up to 10 MiB per original and 4 MiB of
  extracted text, returned in 8,000-character pages. UTF-8 files of any extension
  are read; PDF and DOCX use existing extractors. Other binaries return metadata
  and an explicit unsupported-content reason. Scanned PDFs have no OCR.

No folder-wide 100-file/512-KiB indexing limit applies. The 100-path listing size
is a page, not the number of files allowed in the folder. Searches have a five-second
timeout and four-MiB output bound; overly broad searches must be narrowed. Hermes
still has its existing eight-iteration/time/output bounds, so one run does not
read an unlimited directory. No file writes, shell execution or automatic
background indexing are exposed.

Each text read returns a SHA-256 version hash and a `local:...` citation identifying
the file and page. Runs save that citation as provenance, with revision zero
meaning a local file version rather than a database source revision. Historical
reports are not refreshed when files change. Provenance does not verify generated
claims independently. File contents are untrusted evidence, not agent instructions.
Relevant excerpts are sent to the configured AI provider during Agent work.

Ordinary Copilot chat uses the existing indexed retrieval path. Its Local files
filter and citation inspector apply to optional saved snapshots, not live mounts.
Choose saved snapshots when you need chat retrieval or backend availability after
the source computer is offline.

## Native chooser

POST `/projects/:projectId/local-folders/live/pick` opens a Windows Common Item
Dialog through the checked-in `scripts/select-local-folder.ps1`, using the built-in
Windows PowerShell in STA mode. No new desktop framework or package is required.
The picker process inherits only the small OS environment it needs, not PATs,
provider credentials or personal PowerShell profiles. Only one chooser may be
open per backend; it times out after two minutes and is terminated if the browser
request closes. Local administrator and project access are checked before
opening and again before saving the selected grant.

This needs an interactive Windows desktop on the backend computer. A Windows
service or remote machine cannot reliably present a dialog on the browser's
computer. GET live includes `nativePickerAvailable` for platform/configuration
availability; it does not assert an interactive desktop health check.
