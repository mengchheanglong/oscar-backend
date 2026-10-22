const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

module.exports = async function featureChecks({ api, state, check, output }) {
  await check(
    'Completing task activity does not inflate the measured business outcome',
    async () => {
      const task = await api(`/projects/${state.projectId}/tasks/${state.taskId}`);
      await api(`/projects/${state.projectId}/tasks/${state.taskId}`, 'PATCH', {
        version: task.version,
        status: 'DONE',
      });
      const summary = await api(`/goals/${state.goalId}/summary`);
      assert.equal(summary.measuredProgress, 35);
      assert.ok(summary.tasksProgress > 0);
    },
  );
  await check(
    'Successful Hermes work becomes reviewed memory while raw execution and dialogue remain separate',
    async () => {
      assert.ok(state.runId, 'No successful Hermes work to capture');
      const candidate = await api(
        `/mavis/memories/from-run/${state.runId}?projectId=${state.projectId}`,
        'POST',
        { statement: 'Hermes verified synthetic operating profit is 50 dollars.' },
      );
      assert.equal(candidate.status, 'PROPOSED');
      await api(`/mavis/memories/${candidate.id}/approve`, 'POST', {
        expectedVersion: candidate.version,
      });
      const pack = await api('/mavis/context/retrieve', 'POST', {
        projectId: state.projectId,
        query: 'operating profit',
        includeHistoricalConversations: true,
        includeExecutionResults: true,
      });
      assert.ok(pack.approvedMemories.some((memory) => memory.id === candidate.id));
      assert.ok(pack.rawExecutionResults.some((run) => run.runId === state.runId));
      assert.ok(pack.historicalConversations.length > 0);
    },
  );
  await check(
    'Private saved preferences through MCP and live folder evidence through Hermes',
    async () => {
      const base = `/projects/${state.projectId}`;
      const note = await api(`${base}/ai/memories`, 'POST', {
        kind: 'PREFERENCE',
        content: 'Prefer concise validation briefings.',
        userConfirmed: true,
        idempotencyKey: randomUUID(),
      });
      const notes = await api(`${base}/ai/memories`);
      assert.ok(notes.some((item) => item.id === note.id));
      const directory = path.join(output, 'local-evidence');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'validation-notes.md'),
        'Synthetic local evidence: LOCAL-ORBIT-73. Customer interviews first.',
      );
      const folder = await api(`${base}/local-folders/live`, 'POST', { path: directory });
      const pat = await api('/auth/api-keys', 'POST', {
        name: 'Connected local evidence',
        expiresInDays: 1,
      });
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
      const client = new Client({ name: 'connected-folder-check', version: '1' });
      try {
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: ['-r', 'ts-node/register/transpile-only', 'scripts/mcp-server.ts'],
            cwd: process.cwd(),
            env: {
              ...process.env,
              OSCAR_API_URL: 'http://localhost:3101/api/v1',
              OSCAR_API_KEY: pat.rawToken,
              OSCAR_PROJECT_ID: state.projectId,
            },
            stderr: 'pipe',
          }),
        );
        const read = await client.callTool({
          name: 'list_copilot_memories',
          arguments: { projectKeyOrId: state.projectId },
        });
        assert.ok(!read.isError);
        assert.match(JSON.stringify(read.content), /Prefer concise validation briefings/);
      } finally {
        await client.close();
        await api(`/auth/api-keys/${pat.id}`, 'DELETE');
      }
      const run = await api(`${base}/ai/runs`, 'POST', {
        prompt: `Use read_local_file with folderId=${folder.id} and path=validation-notes.md. Report the exact synthetic sentinel from the file. Do not modify anything.`,
        idempotencyKey: randomUUID(),
      });
      const deadline = Date.now() + 210000;
      let finished;
      do {
        finished = await api(`${base}/ai/runs/${run.id}`);
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(finished.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (Date.now() < deadline);
      assert.equal(finished.status, 'SUCCEEDED', finished.errorCode || 'Folder runtime failed');
      assert.match(finished.artifact, /LOCAL-ORBIT-73/);
      assert.match(JSON.stringify(finished.events), /read_local_file/);
    },
  );
};
