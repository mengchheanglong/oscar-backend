# Private conversation-history recall

Normal Copilot chat can retrieve older dialogue from the same actor and project.
This complements the working transcript, durable summaries, reviewed memories,
and cited project evidence. The repository owns retrieval and invalidation SQL;
the context service owns prompt budgeting and transactional answer persistence.

## Retrieval policy

PostgreSQL English full-text search selects up to six completed user/assistant
messages from live, privately owned conversations. Messages marked excluded are
never eligible. Active account and membership checks remain in the query even
when All Workspaces is enabled. Within the current chat, only messages before the
saved compaction boundary are searched; recent messages already enter context.

Results carry message ID, conversation ID, role and up to 900 characters of text.
Their serialized UTF-8 size is capped at the smaller of 6,000 bytes and one eighth
of the working budget. Optional recall is dropped when the system prompt and latest
request need that space. The planner reserves recall's full serialized size.

Historical snippets enter a user-role message marked untrusted and potentially
outdated. They are not cited project evidence or reviewed personal memory. Current
corrections take priority through prompting, not a factual correctness guarantee.
The keyword baseline can now be combined with optional
[semantic history recall](SEMANTIC_HISTORY_RECALL.md). English stemming, snippet
truncation and six-result ranking can miss relevant context. The evaluation records
remaining multilingual misses. Saved-memory hybrid retrieval and its model-checked
pgvector storage remain separate and unchanged in architecture.

## Excluding and deleting history

The chat UI offers **Exclude from context…** on persisted completed messages. Its
confirmation explains that related generated replies may also be excluded, while
the transcript stays visible. `contextExcluded` is returned on message responses.
The endpoint is:

`POST /api/v1/projects/{projectId}/ai/conversations/{id}/messages/{messageId}/exclude-context`

It requires authentication, CSRF protection, project membership and owning the
private conversation/message. The operation returns 204; unavailable resources
return 404. Repeating an exclusion already applied is a no-op. There is no restore
endpoint in this version. Reviewed saved memories are managed independently.

Successful answers record conversation dependencies on retrieved source chats in
the same transaction as the answer and summary. Excluding a message traverses
those dependencies transitively, marks the selected message excluded, excludes
all existing assistant messages in affected chats, and removes affected summaries.
This conversation-level policy deliberately excludes some unrelated assistant
replies to avoid reusing possible echoes. It does not hide or delete their text.
New, unaffected replies can enter future context normally.
Rebuilding a cleared summary remains subject to the existing 2,000-message/8 MiB
unsummarized-history and eight-compaction-call limits. Large invalidated histories
can fail clearly rather than starting an unbounded paid rebuild.

Deleting a chat uses the same invalidation transaction, then soft-deletes the
conversation. Its messages cannot enter recall. User-authored messages in other
chats remain eligible, including explicit copies or repetitions of an excluded
fact. This is a future-context control, not retroactive erasure of all copies,
reviewed memories, exports, provider inputs or visible replies.

A project/user history revision serializes exclusions against answer commits.
Any in-flight answer prepared before a privacy change receives 409 HISTORY_CHANGED
instead of saving stale output or advancing a summary. It can still incur provider
usage before the revision check. Summary creation is also checked, even when an
exclusion deleted an earlier summary row. Dependency cycles terminate through a
deduplicating recursive query. Failed transactions leave source and derived
context unchanged.

## Database release

Apply `1792108800000-HistoryRecall` explicitly before starting this backend. It adds
message exclusion flags, a generated tsvector and GIN index, revision rows and
composite-owner dependency references. PostgreSQL/pgvector remains required by the
database migration chain; there is no separate search service or silent fallback.
The generated search column backfills existing messages and takes table locks;
review release capacity for a large persistent database. No vector index is added.

Automated checks use a dedicated database and scripted providers. They cover
cross-user/project boundaries, compaction boundaries, byte limits, transitive
invalidation including cycles, repeated exclusions, source deletion, stale
in-flight answers, and HTTP authentication/CSRF/validation. The guide's progress
ledger records actual checks and activation status.
