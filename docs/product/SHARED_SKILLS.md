# Customize, plugins, and shared skills

OSCAR owns a personal skill library. A skill is a named, versioned set of text
instructions, not an executable package. The library is private to its account
and usable across that account’s projects. It does not expose another member’s
skills or chat attachments, even to a project manager.

## Use

Open **Customize → Skills**, choose **Add skill**, and enter a name, slash command,
description, and instructions. The empty library offers an optional **Clear plan**
example; nothing is installed or seeded automatically. Each skill allows 12,000
characters. Commands start with a lowercase letter and may contain lowercase
letters, numbers, hyphens, and underscores (48 characters maximum).

Start a message with `/clear-plan` (or the command you created), followed by the
task. Multiple leading commands are supported. Typing `/` in the composer offers
matching skills. A chat supports four attached skills. Its chips show the attached
commands and allow removal. Attachments survive page reloads, server restarts,
and later turns. Each agent may apply their guidance when relevant; a skill does
not force every answer into the same format.

Editing a library skill increments its version. Existing chats retain the version
explicitly selected; invoke its command again to update that chat. Detaching or
deleting removes the skill from future sends. Already saved turns and dispatched
work retain their frozen instructions for predictable retries. Deleting cannot
recall instructions already sent to an external agent.

## Agents and connected workspaces

- OSCAR includes the attached snapshots in its generation context. Failed sends
  reuse the saved user turn’s snapshot, even if the library changes before retry.
- Hermes receives the snapshot in its runtime instructions. Its existing restricted
  tool profile and proposal review boundary remain authoritative.
- T3 and Paperclip handoffs persist a snapshot before dispatch and append it to
  their native task instructions. Later handoffs in the same OSCAR chat inherit
  the attachments without another skill selection. Queued work uses its saved
  version even after an edit. Native execution approval requirements still apply.
- Other workspaces connected through **OSCAR MCP** can call `list_skills`, then
  `get_skill` with the selected ID. They receive the credential owner’s library
  through the normal authenticated API. Reconnect an existing MCP client after
  updating the server to discover the new tools. Native agents decide when to
  consult and apply this guidance; OSCAR does not silently install files into
  their global skill directories or supply its credentials in task prompts.

Instructions cannot grant permissions, enable unavailable tools, bypass human
review, or authorize actions beyond the current task. Bundled scripts, filesystem
imports, remote marketplace installation, and team publishing are not included.

## Plugins UI

**Customize → Plugins** lists the existing Hermes, T3, Paperclip, GitHub, and OSCAR
MCP integrations. Each opens the same connection controls used in Settings.
Entering Customize collapses the main navigation to its icon rail and opens a
secondary sidebar. Leaving restores the saved sidebar preference. Settings URLs
remain supported. The catalog does not claim a connection is active merely
because its integration is available.

## API and persistence

- `GET/POST /skills`, `GET/PATCH/DELETE /skills/:id`: authenticated personal
  library; edits require the current version; cookie writes require CSRF.
- `GET /projects/:projectId/ai/conversations/:conversationId/skills`: owned chat
  attachment summaries; active project membership is checked.
- `DELETE .../skills/:id`: detach from the owned chat. Busy OSCAR turns reject
  concurrent detachment. Run snapshots already in progress remain immutable.
- Leading commands are resolved on the backend for normal chat, Hermes, and
  external handoffs. Unknown commands and attachment overflow roll back the
  attachment batch instead of silently claiming success.
- Migration `1792980000000-SharedSkills` adds `skills`, `conversation_skills`, and
  JSON snapshots on messages, Hermes runs, and platform handoffs. No existing
  project data is reset or renamed.

Verification covers real PostgreSQL persistence, ownership/membership checks,
version changes, detach/delete, command bounds, atomic rollback, retries, HTTP
validation/CSRF, MCP transport, and the actual instruction payloads delivered to
runtime/adapter fixtures. Those adapter checks verify OSCAR’s delivery contract;
they are not claims that live provider models always follow every instruction.

The [Founder pack](FOUNDER_SKILLS.md) is the first installed community collection.
Its 11 entries preserve upstream instructions and references with explicit host
capability boundaries.
