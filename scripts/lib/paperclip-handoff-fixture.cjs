const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');

// Contract fixture: no Paperclip installation or external agent is simulated as live.
module.exports = async function paperclipFixture(port = 3103) {
  const companyId = randomUUID(),
    agentId = randomUUID(),
    projectId = randomUUID();
  const issues = new Map(),
    keys = new Map(),
    requests = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== 'Bearer synthetic-paperclip-handoff') return send(403, {});
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    requests.push({ method: req.method, path: url.pathname });
    if (req.method === 'GET' && url.pathname === `/api/companies/${companyId}/agents`)
      return send(200, [
        { id: agentId, companyId, name: 'Protocol fixture agent', status: 'idle' },
      ]);
    if (req.method === 'GET' && url.pathname === `/api/companies/${companyId}/projects`)
      return send(200, [{ id: projectId, companyId, name: 'Protocol fixture workspace' }]);
    if (url.pathname === `/api/companies/${companyId}/issues`) {
      if (req.method === 'GET')
        return send(
          200,
          [...issues.values()].map((row) => row.issue),
        );
      if (req.method === 'POST') {
        let text = '';
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 20000) return send(413, {});
        }
        const body = JSON.parse(text);
        if (keys.has(body.idempotencyKey))
          return send(200, issues.get(keys.get(body.idempotencyKey)).issue);
        if (body.assigneeAgentId !== agentId || (body.projectId && body.projectId !== projectId))
          return send(400, {});
        const id = randomUUID();
        const issue = {
          id,
          identifier: `QA-${issues.size + 1}`,
          companyId,
          projectId: body.projectId || null,
          assigneeAgentId: agentId,
          title: body.title,
          description: body.description,
          status: 'todo',
        };
        issues.set(id, { issue, reads: 0 });
        keys.set(body.idempotencyKey, id);
        return send(201, issue);
      }
    }
    const match = url.pathname.match(/^\/api\/issues\/([^/]+)(\/comments)?$/);
    const row = match && issues.get(match[1]);
    if (row) {
      if (req.method === 'GET' && match[2])
        return send(
          200,
          row.issue.status === 'done'
            ? [
                {
                  id: randomUUID(),
                  issueId: row.issue.id,
                  companyId,
                  authorAgentId: agentId,
                  createdAt: '2026-10-20T00:00:00.000Z',
                  body: 'PAPERCLIP-RESULT-73: the assigned protocol fixture task is complete. This is test fixture evidence, not a live Paperclip agent execution.',
                },
              ]
            : [],
        );
      if (req.method === 'GET') {
        if (++row.reads >= 3 && row.issue.status !== 'cancelled') row.issue.status = 'done';
        return send(200, row.issue);
      }
      if (req.method === 'PATCH') {
        let text = '';
        for await (const chunk of req) text += chunk;
        const body = JSON.parse(text);
        if (body.status !== 'cancelled') return send(400, {});
        row.issue.status = 'cancelled';
        return send(200, row.issue);
      }
    }
    send(404, {});
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { companyId, agentId, projectId, requests, server, issues };
};
