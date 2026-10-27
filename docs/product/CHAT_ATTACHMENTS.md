# Chat attachments and project knowledge

Uploads from the composer belong to the current private chat. Starting with a
file creates the chat first. Originals and extracted passages are stored outside
the shared document/index tables. Existing uploads retain their original project
knowledge scope; no files or vectors are moved or deleted by this migration.
Knowledge opens on Memories; the former file library is Project knowledge, and
`/documents` redirects to that shared-reference view.

## Use

- In a chat, use **+ → Attach files to this chat**, or drop files on the composer.
- Chat context → Files lists uploads even before they are cited. Download the
  original, draft a memory, share with the project, or remove the attachment.
- **Draft a memory** uses the configured generation model to propose a short
  durable summary from at most the first eight passages. The UI identifies
  partial coverage. Edit and explicitly save it before it enters private project
  memory. No automatic memory is created by upload or model generation.
- **Add to project knowledge** explicitly copies the original into the existing
  shared document ingestion workflow. Project contributor access is required.
  Repeating promotion returns the same document; creation and promotion pointer
  commit together. Shared copies remain independently manageable.
- Removal lists all linked reviewed memories. Delete unwanted memories there or
  keep them. Removal excludes earlier assistant replies, clears the durable chat
  summary and increments the history privacy revision. Original user messages
  remain. Chat deletion makes its attachments inaccessible.
- Reviewed chat memories can also be managed under Knowledge → Memories for the
  selected project, and through the existing private-memory settings.

## Access and context

Every attachment operation requires the exact owning user, chat and project,
active membership and a non-deleted chat. The private attachment table is not
reachable through shared document/search/MCP source endpoints. Normal Assistant
and Hermes context includes bounded excerpts from this chat only; T3/Paperclip
handoffs receive these excerpts as untrusted task material. These integrations
receive text, not unrestricted file-system paths or shared download links.
Live upstream agent execution is separate from local excerpt delivery tests.

Chats that have ever held attachments are excluded from cross-chat lexical and
semantic history recall, automatic history indexing, and MAVIS historical/raw
execution context. The flag remains after removal to prevent prior derived text
from escaping through later recall. Recent context within that same chat remains
available until explicitly excluded. Reviewed memories and deliberately promoted
project references are the explicit sharing mechanisms.

Upload/removal take the same advisory lock as ordinary chat turns and refuse
mutation during active agent work. Removal cannot erase excerpts already sent
to external agents; stop the work first and manage any upstream copies there.

## Limits and rollout

Apply migration `1793090000000-ChatAttachments` explicitly, then restart the rebuilt
backend and frontend. It adds private attachment storage and reviewed-memory
provenance without changing existing document vectors or source records. Its
rollback refuses destructive data removal.

Supported: text-based PDF, DOCX, TXT, Markdown and CSV; 20 MiB/file, 20 files or
100 MiB/chat, one million extracted characters/file. Unsupported formats, empty
text and scan-only PDFs fail explicitly. Extraction reuses the existing parsers;
there is no new OCR, image understanding, archive import or code execution.

Passages are ranked by query terms, with beginning-of-file fallbacks and a
24,000-character attachment evidence budget before the normal chat budget.
This is bounded excerpt retrieval, not proof that every page was read, and does
not insert attachment vectors into the shared project embedding index. Summaries
remain drafts and can be incomplete. Soft-deleted originals use the existing
retained local-storage policy, not immediate physical erasure.

The local live verifier is kept ignored under `var/chat-attachments`; it creates
synthetic chats/file/memory/shared copy, checks citation/retry/isolation/removal,
and cleans its own records through ordinary APIs. Never commit tokens or uploads.
