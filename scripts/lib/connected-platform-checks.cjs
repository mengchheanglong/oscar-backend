const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');

module.exports = async function platformChecks({ api, state, check, database, output, results }) {
  const requests = [];
  const fixture = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.setHeader('Content-Type', 'application/json');
    if (
      request.method !== 'GET' ||
      request.headers.authorization !== 'Bearer synthetic-workflow-paperclip'
    ) {
      response.writeHead(403);
      response.end('{}');
      return;
    }
    const value =
      request.url === '/api/companies/workflow/agents'
        ? [{ id: 'research-agent', name: 'Synthetic validation researcher', status: 'running' }]
        : request.url === '/api/companies/workflow/issues'
          ? [
              {
                id: 'validation-issue',
                identifier: 'FLOW-1',
                title: 'Synthetic customer validation',
                status: 'in_progress',
              },
            ]
          : null;
    response.writeHead(value ? 200 : 404);
    response.end(JSON.stringify(value || {}));
  });
  await new Promise((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(3102, '127.0.0.1', resolve);
  });
  try {
    await check(
      'Paperclip HTTP fixture feeds the activity overview and a verified goal mapping',
      async () => {
        const conn = await api('/platforms/connections', 'POST', {
          name: 'Paperclip protocol fixture',
          platformType: 'paperclip',
          baseUrl: 'http://127.0.0.1:3102',
          projectId: state.projectId,
          authToken: 'synthetic-workflow-paperclip',
          metadata: { companyId: 'workflow' },
        });
        assert.equal(conn.status, 'HEALTHY');
        const entities = await api(`/platforms/connections/${conn.id}/entities`);
        assert.equal(entities.type, 'paperclip');
        assert.equal(entities.data.issues.length, 1);
        const link = await api('/platforms/links', 'POST', {
          connectionId: conn.id,
          externalId: 'validation-issue',
          externalEntityType: 'issue',
          goalId: state.goalId,
          projectId: state.projectId,
        });
        assert.equal(link.goalId, state.goalId);
        assert.match(link.externalUrl, /issues\/FLOW-1$/);
        const overview = await api(`/platforms/overview?projectId=${state.projectId}`);
        assert.ok(overview.healthyPlatforms >= 1);
        assert.ok(requests.every((row) => row.method === 'GET'));
        const rows = await database.query(
          'SELECT auth_token FROM platform_connections WHERE id=$1',
          [conn.id],
        );
        assert.match(rows[0].auth_token, /^v1:/);
        assert.ok(!rows[0].auth_token.includes('synthetic-workflow-paperclip'));
        results.external.paperclip =
          'Real HTTP adapter, encrypted credential, native mapping and overview; synthetic upstream fixture because Paperclip is not installed';
      },
    );
    if (process.argv.includes('--reuse-t3') || process.argv.includes('--authorize-t3')) {
      await check(
        'Installed T3 OAuth session survives restart and supplies native activity and goal mapping',
        async () => {
          if (process.argv.includes('--reuse-t3')) {
            const sealed = fs.readFileSync(path.join(output, 't3-credential.sealed'), 'utf8');
            assert.match(sealed, /^v1:/);
            await database.query('UPDATE platform_connections SET auth_token=$1 WHERE id=$2', [
              sealed,
              state.t3ConnectionId,
            ]);
          }
          const health = await api(`/platforms/connections/${state.t3ConnectionId}/test`, 'POST');
          assert.equal(health.status, 'HEALTHY');
          const entities = await api(`/platforms/connections/${state.t3ConnectionId}/entities`);
          assert.equal(entities.type, 't3');
          const groups = Object.fromEntries(
            Object.entries(entities.data).map(([key, rows]) => [key, rows.length]),
          );
          assert.ok(groups.workspaces > 0);
          assert.ok(groups.threads > 0);
          const thread = entities.data.threads[0];
          const mapping = await api('/platforms/links', 'POST', {
            connectionId: state.t3ConnectionId,
            externalId: thread.id,
            externalEntityType: 'thread',
            goalId: state.goalId,
            projectId: state.projectId,
          });
          assert.match(mapping.externalUrl, /^t3-thread:\/\/v1\//);
          const overview = await api(`/platforms/overview?projectId=${state.projectId}`);
          assert.equal(overview.healthyPlatforms, 2);
          results.external.t3 = {
            status:
              'Real installed T3; browser PKCE OAuth, read-only activity, native goal mapping and restart persistence verified',
            groups,
          };
        },
      );
    }
    return fixture;
  } catch (error) {
    fixture.close();
    throw error;
  }
};
