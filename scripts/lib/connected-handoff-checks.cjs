const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function handoffChecks({ api, state, check, results }) {
  const fixture = await require('./paperclip-handoff-fixture.cjs')();
  const base = `/projects/${state.projectId}`;
  async function until(action, predicate, timeout = 210000) {
    const deadline = Date.now() + timeout;
    do {
      const result = await action();
      if (predicate(result)) return result;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    throw Error('Handoff acceptance timed out');
  }
  try {
    await check(
      'Live Hermes → OSCAR summary retains full artifact and originating chat',
      async () => {
        const conversation = await api(`${base}/ai/conversations`, 'POST', {
          title: 'Hermes handoff acceptance',
          defaultMode: 'WORKSPACE',
        });
        state.hermesConversationId = conversation.id;
        const body = {
          conversationId: conversation.id,
          idempotencyKey: randomUUID(),
          prompt:
            'Use Hermes to calculate pricing: price 20 dollars, variable cost 5 dollars, fixed cost 100 dollars, quantity 10 units. Use calculate_pricing. Report operating profit and the assumptions. Do not propose changes.',
        };
        const first = await api(`${base}/ai/runs`, 'POST', body);
        assert.equal((await api(`${base}/ai/runs`, 'POST', body)).id, first.id);
        const run = await until(
          () => api(`${base}/ai/runs/${first.id}`),
          (r) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.status),
        );
        assert.equal(run.status, 'SUCCEEDED', run.errorCode || 'Hermes did not complete');
        assert.match(run.artifact, /50/);
        assert.ok(run.events.some((e) => e.name === 'calculate_pricing'));
        const messages = await api(`${base}/ai/conversations/${conversation.id}/messages`);
        const answer = messages.find((m) => m.id === run.assistantMessageId);
        assert.equal(answer.modelName, 'OSCAR / Hermes');
        assert.match(answer.content, /50|fifty/i);
        assert.equal(messages.filter((m) => m.role === 'assistant').length, 1);
      },
    );
    await check(
      'Paperclip protocol HTTP → assigned issue → OSCAR result with idempotency and read-only boundary',
      async () => {
        const connection = await api('/platforms/connections', 'POST', {
          name: 'Paperclip handoff protocol fixture',
          platformType: 'paperclip',
          baseUrl: 'http://127.0.0.1:3103',
          authToken: 'synthetic-paperclip-handoff',
          projectId: state.projectId,
          metadata: { companyId: fixture.companyId },
        });
        state.paperclipConnectionId = connection.id;
        const conversation = await api(`${base}/ai/conversations`, 'POST', {
          title: 'Paperclip handoff acceptance',
          defaultMode: 'WORKSPACE',
        });
        state.paperclipConversationId = conversation.id;
        const body = {
          platformType: 'paperclip',
          conversationId: conversation.id,
          connectionId: connection.id,
          remoteAgentId: fixture.agentId,
          remoteProjectId: fixture.projectId,
          prompt: 'Review the protocol fixture task and report its result marker.',
          idempotencyKey: randomUUID(),
        };
        await api(`${base}/ai/handoffs`, 'POST', body, state.auth, 403);
        await api(`/platforms/connections/${connection.id}`, 'PATCH', {
          metadata: { companyId: fixture.companyId, paperclipAccess: 'supervised' },
        });
        const first = await api(`${base}/ai/handoffs`, 'POST', body);
        assert.equal((await api(`${base}/ai/handoffs`, 'POST', body)).id, first.id);
        const row = await until(
          async () =>
            (await api(`${base}/ai/handoffs?conversationId=${conversation.id}`)).find(
              (r) => r.id === first.id,
            ),
          (r) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.status),
          60000,
        );
        assert.equal(row.status, 'SUCCEEDED', row.notice);
        assert.match(row.result, /PAPERCLIP-RESULT-73/);
        assert.equal(fixture.requests.filter((r) => r.method === 'POST').length, 1);
        const messages = await api(`${base}/ai/conversations/${conversation.id}/messages`);
        const answer = messages.find((m) => m.id === row.assistantMessageId);
        assert.equal(answer.modelName, 'OSCAR / Paperclip');
        assert.match(answer.content, /PAPERCLIP-RESULT-73/);
        assert.match(answer.content, /Open Paperclip issue/);
        state.paperclipFixture = {
          companyId: fixture.companyId,
          agentId: fixture.agentId,
          projectId: fixture.projectId,
        };
        results.external.paperclipExecution =
          'Real HTTP adapter and OSCAR stack against an explicit protocol fixture; no live Paperclip installation is available.';
      },
    );
    return fixture.server;
  } catch (error) {
    await new Promise((resolve) => fixture.server.close(resolve));
    throw error;
  }
};
