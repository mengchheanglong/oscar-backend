// Four bounded live requests; --compilation adds one. Resumes saved retries safely.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const reportPath = path.join(root, 'var/private-library/live-chat.json');
async function api(route, method = 'GET', body, expected = 200) {
  const response = await fetch('http://127.0.0.1:43100/api/v1' + route, {
    method,
    headers: {
      Authorization: `Bearer ${env.AI_WORKSPACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  });
  if (expected !== 200) {
    assert.equal(response.status, expected);
    return;
  }
  assert(response.ok, `LOCAL_HTTP_${response.status}`);
  const value = await response.json();
  return value.data ?? value;
}
async function main() {
  await api('/auth/me');
  const collections = await api('/knowledge/collections');
  assert(collections.some((c) => c.id === 'personal-library' && c.indexed_books > 0));
  assert(collections.some((c) => c.id === 'social-systems' && c.indexed_books > 0));
  const unauth = await fetch('http://127.0.0.1:43101/api/v1/knowledge/collections');
  assert.equal(unauth.status, 401);
  console.log('PASS: normal authentication and owner-scoped collection readiness');
  if (!process.argv.includes('--live')) return;
  assert(env.OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET?.length >= 32);
  const project = (await api('/projects')).find((p) => p.key === 'AIW');
  assert(project);
  let report;
  if (fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath));
  else {
    const conversation = await api(`/projects/${project.id}/ai/conversations`, 'POST', {
      title: 'Private reference library — integration acceptance',
      defaultMode: 'WORKSPACE',
    });
    report = {
      projectId: project.id,
      conversationId: conversation.id,
      checkedAt: new Date().toISOString(),
      requests: [],
      checks: [],
    };
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  save();
  const route = `/projects/${report.projectId}/ai/conversations/${report.conversationId}/messages`;
  const cases = [
    [
      'private-finance',
      'personal-library',
      true,
      'Using The Psychology of Money from my private reference library, explain why financial plans need a margin of safety. Cite the actual retrieved book and PDF page, distinguish the author perspective from measured results, and keep it under 100 words.',
    ],
    [
      'private-management',
      'social-systems',
      true,
      'Using High Output Management from my Social Systems library, explain how a manager output relates to team output. Cite the actual retrieved book and PDF page. Keep it under 100 words.',
    ],
    [
      'unanswerable',
      'personal-library',
      true,
      'Source evaluation test: what exact 14-character code did I seal in a physical envelope yesterday? Use only library evidence. If this information is unavailable, say so and do not guess a code. Keep it under 50 words.',
    ],
    [
      'opt-out',
      'mba',
      false,
      'In one sentence, describe the purpose of a reading plan without consulting reference knowledge.',
    ],
  ];
  if (process.argv.includes('--compilation'))
    cases.push([
      'private-compilation',
      'personal-library',
      true,
      'Using the physics material in my personal reference library, explain why a satellite in a circular orbit is accelerating even if its speed is constant. Cite the actual retrieved source and physical PDF page. For mixed compilation sources, do not claim a verified book edition or author. Keep it under 90 words.',
    ]);
  for (const [name, knowledgeScope, includeKnowledge, content] of cases) {
    if (report.checks.some((c) => c.name === name && c.status === 'PASS')) continue;
    let request = report.requests.find((r) => r.name === name);
    if (!request) {
      request = {
        name,
        body: { content, includeKnowledge, knowledgeScope, clientRequestId: randomUUID() },
      };
      report.requests.push(request);
      save();
    }
    const result = await api(route, 'POST', request.body);
    const answer = result.assistantMessage;
    assert.equal(answer.status, 'COMPLETED');
    assert.notEqual(answer.modelName, 'mock-llm');
    const citations = answer.citations.filter((c) => c.sourceType === 'EXTERNAL_KNOWLEDGE');
    if (name.startsWith('private-')) {
      assert(citations.length > 0, 'PRIVATE_BOOK_CITATION_REQUIRED');
      assert(
        citations.every((c) => c.bookId && c.collectionId === knowledgeScope && c.pageStart > 0),
      );
      assert(!/[A-Z]:[\\/]|file:\/\//.test(JSON.stringify(citations)), 'LOCAL_PATH_LEAK');
    }
    if (name === 'unanswerable')
      assert(
        /unavailable|cannot|can't|no evidence|not (know|provided|contain|found)/i.test(
          answer.content,
        ),
        'ABSTENTION_REQUIRED',
      );
    if (name === 'private-compilation') {
      const catalog = JSON.parse(
        fs.readFileSync('D:/AI/OSCAR/Knowledge/Catalog/library.json', 'utf8'),
      );
      const windows = new Map(
        catalog.virtual_books.filter((r) => r.compilation_window).map((r) => [r.id, r]),
      );
      assert(
        citations.some((c) => {
          const source = windows.get(c.bookId);
          return (
            source && c.pageStart >= source.page_range[0] && c.pageStart <= source.page_range[1]
          );
        }),
        'COMPILATION_CITATION_REQUIRED',
      );
      assert(
        /centripetal|direction|velocity/i.test(answer.content),
        'PHYSICS_EXPLANATION_REQUIRED',
      );
    }
    if (name === 'opt-out') assert.equal(citations.length, 0);
    const replay = await api(route, 'POST', request.body);
    assert.equal(replay.assistantMessage.id, answer.id);
    report.checks.push({
      name,
      status: 'PASS',
      messageId: answer.id,
      model: answer.modelName,
      answer: answer.content,
      citations,
      replaySameMessage: true,
    });
    save();
    console.log('PASS:', name, 'saved answer and identical request replay');
  }
  const saved = await api(route);
  for (const check of report.checks) {
    const message = saved.find((m) => m.id === check.messageId);
    assert(message);
    if (check.citations.length)
      assert(message.citations.some((c) => c.chunkId === check.citations[0].chunkId));
  }
  await api(route, 'POST', { ...report.requests[0].body, knowledgeScope: 'social-systems' }, 409);
  report.savedCitationReload = true;
  report.scopeChangeConflict = true;
  save();
  console.log('PASS: citation reload, scope-change conflict and private local report');
}
main().catch((error) => {
  const code = /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'CHECK_FAILED';
  console.error(
    `PRIVATE_LIBRARY_ACCEPTANCE_FAILED (${code}); inspect the private acceptance report. No credentials logged.`,
  );
  process.exitCode = 1;
});
