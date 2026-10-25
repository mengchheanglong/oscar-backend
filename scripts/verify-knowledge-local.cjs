// Explicit local acceptance check. --live makes two bounded real generation requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const environment = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const origin = 'http://127.0.0.1:43100';
const output = path.join(root, 'var/knowledge-integration/latest.json');

async function api(route, method = 'GET', body) {
  const response = await fetch(`${origin}/api/v1${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${environment.AI_WORKSPACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) throw new Error(`LOCAL_API_HTTP_${response.status}`);
  const value = await response.json();
  return value.data ?? value;
}

async function main() {
  const target = new URL(environment.DATABASE_URL);
  assert(
    ['127.0.0.1', 'localhost'].includes(target.hostname) &&
      target.port === '43104' &&
      target.pathname === '/oscar',
    'LOCAL_DATABASE_REQUIRED',
  );
  assert(environment.AI_WORKSPACE_API_KEY, 'LOCAL_PAT_REQUIRED');
  assert(environment.OSCAR_KNOWLEDGE_ENABLED === 'true', 'KNOWLEDGE_MUST_BE_ENABLED');
  const ready = await fetch(`${origin}/api/v1/health/ready`, { signal: AbortSignal.timeout(5000) });
  assert(ready.ok, 'LOCAL_FRONTEND_PROXY_UNAVAILABLE');
  await api('/auth/me');
  const projects = await api('/projects');
  const project = projects.find((item) => item.key === 'AIW');
  assert(project, 'EXISTING_LOCAL_AIW_PROJECT_REQUIRED');
  console.log('PASS: frontend proxy, normal PAT authentication and existing AIW project access');
  if (!process.argv.includes('--live')) return;
  assert(
    environment.AI_ENABLED === 'true' && environment.DEEPSEEK_API_KEY,
    'CONFIGURED_GENERATION_REQUIRED',
  );
  const conversation = await api(`/projects/${project.id}/ai/conversations`, 'POST', {
    title: 'Knowledge integration acceptance',
    defaultMode: 'WORKSPACE',
  });
  const route = `/projects/${project.id}/ai/conversations/${conversation.id}/messages`;
  const request = {
    content:
      'Using the synthetic Pricing experiments notes, how should Rentify test a basic and premium subscription? Answer in two short sentences and cite the notes.',
    clientRequestId: randomUUID(),
    includeKnowledge: true,
  };
  const answer = await api(route, 'POST', request);
  assert.equal(answer.assistantMessage.status, 'COMPLETED', 'LIVE_GENERATION_FAILED');
  const external = answer.assistantMessage.citations.filter(
    (citation) => citation.sourceType === 'EXTERNAL_KNOWLEDGE',
  );
  assert(
    external.some(
      (citation) =>
        citation.courseCode === 'DEMO-PRICING' &&
        citation.sourceUrl === 'https://example.org/oscar-demo/pricing' &&
        citation.locator === 'Pricing experiments',
    ),
    'EXPECTED_COURSE_CITATION_MISSING',
  );
  assert.notEqual(answer.assistantMessage.modelName, 'mock-llm');
  const replay = await api(route, 'POST', request);
  assert.equal(
    replay.assistantMessage.id,
    answer.assistantMessage.id,
    'RETRY_MUST_REUSE_SAVED_ANSWER',
  );
  const saved = await api(route);
  assert(
    saved.some(
      (message) =>
        message.id === answer.assistantMessage.id &&
        message.citations.some((citation) => citation.chunkId === external[0].chunkId),
    ),
    'PERSISTED_CITATION_MISSING',
  );
  console.log(
    'PASS: real configured model answer, external citation persistence and idempotent replay',
  );
  const ordinary = await api(route, 'POST', {
    content: 'In one sentence, explain what an experiment is using general knowledge only.',
    clientRequestId: randomUUID(),
    includeKnowledge: false,
  });
  assert.equal(ordinary.assistantMessage.status, 'COMPLETED', 'ORDINARY_CHAT_FAILED');
  assert(
    !ordinary.assistantMessage.citations.some(
      (citation) => citation.sourceType === 'EXTERNAL_KNOWLEDGE',
    ),
    'EXTERNAL_EVIDENCE_MUST_REQUIRE_OPT_IN',
  );
  console.log('PASS: normal workspace chat with course knowledge off');
  const report = {
    checkedAt: new Date().toISOString(),
    liveGeneration: true,
    corpus: 'Original synthetic CC0 notes; no MIT material imported',
    model: answer.assistantMessage.modelName,
    conversationUrl: `${origin}/assistant?conversation=${conversation.id}`,
    answer: answer.assistantMessage.content,
    citations: answer.assistantMessage.citations,
    checks: [
      'frontend proxy',
      'authenticated project access',
      'real model generation',
      'external citation persistence',
      'idempotent replay',
      'ordinary chat opt-out',
    ],
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Saved private verification report: ${output}`);
}

main().catch(() => {
  console.error(
    'KNOWLEDGE_ACCEPTANCE_FAILED: inspect local readiness and the acceptance conversation. No credentials or response bodies logged.',
  );
  process.exitCode = 1;
});
