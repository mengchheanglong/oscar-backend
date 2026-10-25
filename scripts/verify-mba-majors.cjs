// Local acceptance for the explicitly approved shared MBA-major collection.
// --live makes three bounded requests through the existing configured model.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const origin = 'http://127.0.0.1:43100';
const output = path.join(root, 'var/mba-majors/latest.json');

async function api(route, method = 'GET', body) {
  const response = await fetch(`${origin}/api/v1${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.AI_WORKSPACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  assert(response.ok, `LOCAL_API_HTTP_${response.status}`);
  const value = await response.json();
  return value.data ?? value;
}

async function main() {
  const target = new URL(env.DATABASE_URL);
  assert(
    ['127.0.0.1', 'localhost'].includes(target.hostname) &&
      target.port === '43104' &&
      target.pathname === '/oscar',
    'LOCAL_DATABASE_REQUIRED',
  );
  assert(env.OSCAR_KNOWLEDGE_COLLECTION === 'mba-majors', 'MBA_MAJORS_COLLECTION_REQUIRED');
  assert(env.OSCAR_KNOWLEDGE_ENABLED === 'true', 'KNOWLEDGE_ENABLED_REQUIRED');
  await api('/auth/me');
  const project = (await api('/projects')).find((p) => p.key === 'AIW');
  assert(project, 'EXISTING_AIW_PROJECT_REQUIRED');
  console.log('PASS: frontend proxy, ordinary authentication and existing project');
  if (!process.argv.includes('--live')) return;
  assert(env.AI_ENABLED === 'true' && env.DEEPSEEK_API_KEY, 'CONFIGURED_GENERATION_REQUIRED');
  const chat = await api(`/projects/${project.id}/ai/conversations`, 'POST', {
    title: 'Approved MBA majors — integration acceptance',
    defaultMode: 'WORKSPACE',
  });
  const route = `/projects/${project.id}/ai/conversations/${chat.id}/messages`;
  const report = {
    checkedAt: new Date().toISOString(),
    collection: 'mba-majors',
    conversationId: chat.id,
    conversationUrl: `${origin}/assistant?conversation=${chat.id}`,
    checks: [],
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const saveReport = () =>
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  saveReport();
  for (const [name, content] of [
    [
      'finance',
      'Using the approved MBA course library, explain how WACC is used to discount free cash flow. Cite the retrieved course source. Keep it under 100 words and distinguish a teaching example from a measured company result.',
    ],
    [
      'healthcare',
      'Using the approved MBA library, explain the basic difference between Medicare and Medicaid and one implication for healthcare management. Cite the retrieved source. Treat this as a US educational example, keep it under 100 words, and do not give clinical advice.',
    ],
  ]) {
    const request = { content, includeKnowledge: true, clientRequestId: randomUUID() };
    const result = await api(route, 'POST', request);
    const answer = result.assistantMessage;
    assert.equal(answer.status, 'COMPLETED');
    const external = answer.citations.filter((c) => c.sourceType === 'EXTERNAL_KNOWLEDGE');
    assert(external.length > 0, `${name.toUpperCase()}_COURSE_CITATION_REQUIRED`);
    assert(
      external.every(
        (c) => c.chunkId && c.sourceId && c.courseCode && c.collectionId === 'mba-majors',
      ),
      'NEW_COLLECTION_CITATION_REQUIRED',
    );
    assert.notEqual(answer.modelName, 'mock-llm');
    const replay = await api(route, 'POST', request);
    assert.equal(replay.assistantMessage.id, answer.id, 'IDEMPOTENT_REPLAY_REQUIRED');
    report.checks.push({
      name,
      status: 'PASS',
      messageId: answer.id,
      model: answer.modelName,
      answer: answer.content,
      citations: external,
      replaySameMessage: true,
    });
    saveReport();
    console.log(`PASS: ${name} real-model answer and persisted course citations`);
  }
  const ordinary = await api(route, 'POST', {
    content:
      'In one sentence, explain the general purpose of a study plan without consulting course knowledge.',
    includeKnowledge: false,
    clientRequestId: randomUUID(),
  });
  assert.equal(ordinary.assistantMessage.status, 'COMPLETED');
  assert(!ordinary.assistantMessage.citations.some((c) => c.sourceType === 'EXTERNAL_KNOWLEDGE'));
  report.checks.push({ name: 'ordinary-chat-opt-out', status: 'PASS' });
  const saved = await api(route);
  for (const check of report.checks.filter((c) => c.messageId)) {
    const message = saved.find((m) => m.id === check.messageId);
    assert(message && message.citations.some((c) => c.chunkId === check.citations[0].chunkId));
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log('PASS: course-knowledge opt-out and citation reload; private report saved');
}

main().catch((error) => {
  const code = /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'CHECK_FAILED';
  console.error(
    `MBA_MAJORS_ACCEPTANCE_FAILED (${code}): inspect local readiness and the acceptance chat. No credentials or response bodies logged.`,
  );
  process.exitCode = 1;
});
