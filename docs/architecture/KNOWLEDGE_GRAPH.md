# Reference knowledge graph

`POST /api/v1/knowledge/graph` and MCP `get_knowledge_graph` browse the current
user's permitted independent reference corpus. The backend selects its configured
MBA collection plus personal-library and social-systems, signs reader scope,
bounds the upstream response, and validates the contract. Arbitrary reader
identity and collection overrides are rejected. Query, topicId, sourceId, limit
(maximum 40), and offset are supported.

The frontend exposes `/knowledge?view=graph`. Topic mentions connect books/files
through exact passages. Curated related-topic pairs are discovery hints. Edges
retain IDs, revisions, hashes and physical page/locators. The existing authorized
`/knowledge/passage` endpoint opens original indexed text. Unmapped references
remain visible. Counts are reference records, not distinct books or quality scores.

Main OSCAR preserves the leading ordinary candidate, promotes a usable graph
neighbor within bounded context selection, and caps graph selections at two.
Discovery paths are labeled as hints in model context and persisted with
snapshots/citations. Existing grounding and support review remain mandatory;
connections do not justify factual claims.

Model/provider, embedding identity, project files and grants are unchanged.
Knowledge owns additive migration `0007`, `knowledgectl graph-build`, and rollback
via `KNOWLEDGE_GRAPH_ENABLED=false`. See its `docs/KNOWLEDGE_GRAPH.md` for the
32-topic starter vocabulary and limitations. Project files retain normal
retrieval and are not included in the first reference graph.

Reconnect existing MCP clients to negotiate `get_knowledge_graph`. Ordinary
assistant retrieval uses expansion without an explicit graph tool call.
