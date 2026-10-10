# Local folder sources

Documents includes **Add folder** for the selected project. The first
version uses the browser's read-only directory picker as the local connector.
Original files remain on the user's computer; this is not an upload into the
Documents file store. The browser sends explicitly reviewed text and relative
paths to the authenticated backend, which stores a private searchable snapshot.
Copilot and Hermes can send retrieved excerpts to the configured AI provider.

## User workflow

1. Open Documents with a project selected in a supporting browser, such as Chrome
   or Edge on localhost or HTTPS.
2. Connect a folder, review the eligible paths and text previews, and select files.
3. Click **Connect** to authorize text transfer and indexing.
4. Use **Rescan** to review changed files. New paths start unselected.
5. Disconnect to remove the source and its indexed chunks. Original files are
   untouched. Existing chat answers and saved reports are not erased.

The browser remembers directory capabilities in IndexedDB under the account,
project, and source ID. Capabilities and absolute filesystem paths are not sent
to the backend. Browser access may require renewed permission after reopening;
if persistence is unavailable, the user selects the folder again. Folder names
are labels, not an authenticated filesystem identity on another computer.

Browser directory picker behavior and compatibility are documented by
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker).
Unsupported browsers keep the existing document upload flow.

## Scope and limits

- All file extensions are selectable, including extensionless and individual hidden
  files. New folders begin with an empty selection. UTF-8 content up to 128 KiB
  is indexed directly. PDF and DOCX originals up to 10 MiB are transferred only
  after Connect for server-side text extraction, without storing original files.
- Other binary files and larger text files provide searchable filenames and
  metadata only. Images have no OCR; spreadsheet/slide content, archives and
  media are not extracted. Hidden directories and dependency/build directories
  are skipped. Users explicitly review selected files, including sensitive ones.
- A scan is bounded to 10,000 visited entries, 12 directory levels, 2,000 eligible
  files, and 16 MiB of eligible text. Larger folders require a smaller subfolder.
- Each indexed source accepts at most 100 files and 512 KiB of UTF-8 text.
  Large candidate lists require explicit selection; there is no silent truncation.
  Each account can connect at most 20 sources per project.
- Rescans run only while the page is open. There is no filesystem watcher or
  background desktop daemon. Copilot uses the last indexed snapshot until rescan.
- Local text is indexed for keyword retrieval, including the existing hybrid
  retrieval fallback. No embedding provider request occurs during folder indexing.
  Pure semantic retrieval does not include these keyword-only chunks.
- Source IDs, relative file paths, content hashes and changed-file revisions
  support citations. Unchanged content keeps its file revision. A rescan replaces
  the manifest atomically and removes deselected/deleted paths.

## Authorization and persistence

The API is `GET /projects/:projectId/local-folders`,
`PUT /projects/:projectId/local-folders/:id`, and
`DELETE /projects/:projectId/local-folders/:id` beneath `/api/v1`.
`POST /projects/:projectId/local-folders/extract` accepts one PDF/DOCX multipart
file, returns bounded extracted text and persists no original or index.
Authentication, CSRF, active membership and archived-project checks apply before
extraction. Malformed, empty or oversized extracted content returns an error;
the browser does not submit a replacement manifest after an extraction failure.
Session authentication, CSRF, project policy and service-owned account/membership
checks apply. Private folder sources never become shared team documents.

PUT requires a source name, `expectedVersion`, and the complete reviewed file
manifest. Creation uses version 0. Concurrent or stale rescans receive 409 and
leave the existing index unchanged. Limits, relative paths and exclusions are
also validated on the server. Metadata responses never include file bodies.

Migration `CreateLocalFolders1791590400000` adds local source records and nullable
owner/folder columns to knowledge sources. Existing sources retain their existing
shared project visibility. Every retrieval SQL path restricts private sources to
their owning active account with a current membership. General ingestion source
listing/detail/reindex routes also enforce private ownership. Reindexing a local
source requires a browser rescan rather than trying to read a backend-local path.

Deleting a source cascades through its knowledge sources and chunks. No arbitrary
filesystem path, shell execution, or file editing API is exposed.

Copilot offers a Local files filter. The citation inspector uses authorized
ingestion endpoints to load the current indexed chunks, labels that snapshot's
revision separately from the historical cited excerpt, and links back to
Documents. A disconnected source cannot be loaded there; its previously saved
excerpt may still appear in chat history.
