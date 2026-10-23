/* Full-stack acceptance against a disposable database. --live enables configured providers.
 * --keep leaves the isolated API available for browser/T3 consent checks until Ctrl+C.
 * No deployment data or upstream platform records are mutated.
 */
require('dotenv').config({ quiet: true });
require('ts-node/register/transpile-only');
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client: PgClient } = require('pg');
const assert = require('node:assert/strict');
const live = process.argv.includes('--live');
const keep = process.argv.includes('--keep');
const output = path.resolve(
  process.argv.includes('--handoffs') ? 'var/handoff-workflow' : 'var/connected-workflow',
);
fs.mkdirSync(output, { recursive: true });
const results = {
  startedAt: new Date().toISOString(),
  liveProviders: live,
  checks: [],
  external: { paperclip: 'not installed; protocol fixtures required', t3: 'pending browser OAuth' },
};
let app, database, admin, databaseName, fixture, handoffFixture;
const state = {
  password: randomBytes(24).toString('base64url'),
  email: 'connected-workflow@oscar.test',
};
function save() {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
async function check(name, action) {
  const start = Date.now();
  try {
    const value = await action();
    results.checks.push({ name, status: 'passed', elapsedMs: Date.now() - start });
    console.log(`PASS ${name}`);
    save();
    return value;
  } catch (error) {
    results.checks.push({
      name,
      status: 'failed',
      detail: String(error.message).slice(0, 500),
      elapsedMs: Date.now() - start,
    });
    console.log(`FAIL ${name}: ${String(error.message).slice(0, 250)}`);
    save();
    return null;
  }
}
const apiOrigin = 'http://localhost:3101';
async function login(email = state.email) {
  const response = await fetch(`${apiOrigin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: state.password }),
  });
  assert.equal(response.status, 200, 'Login failed');
  const body = await response.json();
  return {
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
    csrf: body.data.csrfToken,
  };
}
async function api(route, method = 'GET', body, auth = state.auth, expected, headers = {}) {
  const response = await fetch(`${apiOrigin}/api/v1${route}`, {
    method,
    headers: {
      cookie: auth.cookie,
      'x-csrf-token': auth.csrf,
      ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
    redirect: 'manual',
  });
  const value = await response.json().catch(() => null);
  if (expected !== undefined)
    assert.equal(
      response.status,
      expected,
      `${method} ${route}: ${JSON.stringify(value?.error || value).slice(0, 300)}`,
    );
  else
    assert.ok(
      response.ok,
      `${method} ${route}: HTTP ${response.status} ${JSON.stringify(value?.error || value).slice(0, 300)}`,
    );
  return value?.data ?? value;
}
async function until(action, predicate, timeout = 90000) {
  const end = Date.now() + timeout;
  do {
    const value = await action();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (Date.now() < end);
  throw Error('Timed out waiting for workflow state');
}
async function cleanup() {
  if (app) await app.close();
  if (database?.isInitialized) await database.destroy();
  if (fixture) await new Promise((resolve) => fixture.close(resolve));
  if (handoffFixture) await new Promise((resolve) => handoffFixture.close(resolve));
  if (admin) {
    if (databaseName && /^oscar_workflow_[0-9]+_[a-f0-9]+_test$/.test(databaseName))
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
  for (const name of ['private-state.json', 'password.txt'])
    fs.rmSync(path.join(output, name), { force: true });
}
async function main() {
  assert.ok(
    live,
    'Use --live for this provider-connected acceptance test; it makes bounded requests with the configured model and embedding credentials.',
  );
  const testUrl = new URL(process.env.TEST_DATABASE_URL || '');
  assert.ok(
    testUrl.pathname.endsWith('_test') && testUrl.toString() !== process.env.DATABASE_URL,
    'Dedicated test database required',
  );
  databaseName = `oscar_workflow_${process.pid}_${randomBytes(4).toString('hex')}_test`;
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  admin = new PgClient({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  testUrl.pathname = `/${databaseName}`;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: testUrl.toString(),
    PORT: '3101',
    HOST: '127.0.0.1',
    APP_ORIGIN: 'http://localhost:43100',
    INITIAL_ADMIN_EMAIL: '',
    INITIAL_ADMIN_PASSWORD: '',
    AI_ENABLED: String(live),
    HERMES_ENABLED: String(live),
    AI_EMBEDDING_PROVIDER: live ? 'openai' : 'disabled',
    AI_HISTORY_AUTO_INDEX_ENABLED: 'false',
    GITHUB_ENABLED: 'false',
    GITHUB_USE_MOCK: 'false',
    LOCAL_FILES_ENABLED: 'true',
    STORAGE_LOCAL_ROOT: path.join(output, 'uploads'),
    LOCAL_FILES_REGISTRY: path.join(output, 'folders.json'),
    LOG_LEVEL: 'silent',
    AI_DAILY_PROJECT_BUDGET_USD: '1',
    PLATFORM_ALLOWED_ORIGINS:
      'http://127.0.0.1:43102,http://localhost:43102,http://127.0.0.1:3102,http://127.0.0.1:3103',
    PLATFORM_OAUTH_CALLBACK_ORIGIN: apiOrigin,
  });
  const { DataSource } = require('typeorm');
  const { databaseOptions } = require('../src/database/database-options');
  database = await new DataSource(databaseOptions(process.env.DATABASE_URL)).initialize();
  await database.runMigrations({ transaction: 'all' });
  const { User } = require('../src/modules/users/entities/user.entity');
  const argon2 = require('argon2');
  const userRepo = database.getRepository(User);
  const hash = await argon2.hash(state.password);
  for (const [email, role] of [
    [state.email, 'ADMIN'],
    ['outsider-workflow@oscar.test', 'USER'],
  ])
    await userRepo.save(
      userRepo.create({
        email,
        displayName: email === state.email ? 'Connected Workflow QA' : 'Outside reviewer',
        passwordHash: hash,
        isActive: true,
        systemRole: role,
        professionalRole: 'DEVELOPER',
        mustChangePassword: false,
      }),
    );
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { configureApp } = require('../src/common/configure-app');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(3101, '127.0.0.1');
  state.auth = await login();
  const outsider = await login('outsider-workflow@oscar.test');
  const project = await api('/projects', 'POST', {
    key: 'FLOW',
    name: 'Connected launch validation',
  });
  state.projectId = project.id;
  const other = await api('/projects', 'POST', {
    key: 'OPS',
    name: 'Connected operations context',
  });
  state.otherProjectId = other.id;
  const base = `/projects/${project.id}`;
  await check(
    'Real HTTP cookie login, CSRF, project creation and foreign-user isolation',
    async () => {
      await api(base, 'GET', undefined, outsider, 404);
      await api(
        `${base}/tasks`,
        'POST',
        { title: 'CSRF denied' },
        { ...state.auth, csrf: 'invalid' },
        403,
      );
    },
  );
  const goal = await api(`${base}/goals`, 'POST', {
    title: 'Validate demand before building',
    target: '100 validated users',
    motivation: 'Prioritize interviews over cosmetic work',
    milestones: [{ id: 'interviews', title: 'Finish interviews', completed: false }],
    initiatives: [{ id: 'validation', title: 'Customer validation', status: 'TODO' }],
  });
  state.goalId = goal.id;
  await api(`${base}/goals/${goal.id}/metrics`, 'POST', {
    name: 'Validated users',
    unit: 'users',
    baselineValue: 0,
    currentValue: 35,
    targetValue: 100,
    observationDate: '2026-10-19',
  });
  const decision = await api(`${base}/decisions`, 'POST', {
    title: 'Prioritize validation interviews',
    decisionText:
      'Interview customers before polishing the logo. Initial experiment budget is 300 dollars.',
    rationale: 'Actual customer evidence outranks busywork.',
    goalId: goal.id,
  });
  state.decisionId = decision.id;
  await api(`${base}/decisions/${decision.id}`, 'PATCH', {
    version: decision.version,
    status: 'ACCEPTED',
  });
  const task = await api(`${base}/tasks`, 'POST', {
    title: 'Interview five target customers',
    description: 'Use evidence to measure demand.',
    goalId: goal.id,
  });
  state.taskId = task.id;
  await check('Goals, decisions, tasks and outcome metrics persist and link together', async () => {
    const summary = await api(`/goals/${goal.id}/summary`);
    assert.equal(summary.measuredProgress, 35);
    assert.ok(summary.linkedTasks.some((item) => item.id === task.id));
    assert.ok(summary.linkedDecisions.some((item) => item.id === decision.id));
  });
  fs.writeFileSync(
    path.join(output, 'validation-evidence.md'),
    '# Validation evidence\nThe launch validation experiment has 35 validated users out of a target of 100. Prioritize customer interviews, not logo polishing. Synthetic pricing: price 20 dollars, variable cost 5 dollars, fixed cost 100 dollars, 10 units. Operating profit is 50 dollars.\n',
  );
  fs.writeFileSync(
    path.join(output, 'operations-evidence.md'),
    '# Operations evidence\nThe release codename is ORBIT-MANGO. Its quality gate is 42 successful checkout tests.\n',
  );
  await check('Document upload, storage, extraction, outbox and live embeddings', async () => {
    for (const [id, name] of [
      [project.id, 'validation-evidence.md'],
      [other.id, 'operations-evidence.md'],
    ]) {
      const form = new FormData();
      form.set('title', name);
      form.set(
        'file',
        new Blob([fs.readFileSync(path.join(output, name))], { type: 'text/markdown' }),
        name,
      );
      const doc = await api(`/projects/${id}/documents`, 'POST', form);
      await until(
        () => api(`/projects/${id}/documents/${doc.id}`),
        (value) =>
          value.processingStatus === 'READY' ||
          value.processingStatus === 'COMPLETED' ||
          value.processingStatus === 'INDEXED',
      );
    }
    const rows = await database.query(
      'SELECT count(*)::int as total FROM knowledge_chunks WHERE project_id=$1',
      [project.id],
    );
    assert.ok(rows[0].total > 0);
    if (live) {
      const vectors = await database.query(
        'SELECT count(*)::int as total FROM knowledge_chunks WHERE project_id=$1 AND embedding IS NOT NULL',
        [project.id],
      );
      assert.ok(vectors[0].total > 0, 'No persisted embeddings');
    }
  });
  await check(
    'Keyword and hybrid search retrieve uploaded evidence across project APIs',
    async () => {
      for (const [id, q] of [
        [project.id, 'validated'],
        [other.id, 'ORBIT'],
      ]) {
        const found = await api(
          `/projects/${id}/search?q=${q}&mode=${live ? 'hybrid' : 'keyword'}`,
        );
        fs.writeFileSync(path.join(output, `search-${id}.json`), JSON.stringify(found, null, 2));
        assert.match(
          JSON.stringify(found),
          id === project.id ? /validation-evidence/ : /operations-evidence/,
        );
      }
    },
  );
  let memory = await api('/mavis/memories/candidate', 'POST', {
    statement: 'The validation experiment budget is 300 dollars.',
    type: 'DECISION',
    scopeType: 'PROJECT',
    projectId: project.id,
    sourceType: 'DECISION',
    sourceId: decision.id,
  });
  await api(`/mavis/memories/${memory.id}/approve`, 'POST', { expectedVersion: memory.version });
  memory = await api(`/mavis/memories/${memory.id}`);
  const corrected = await api(`/mavis/memories/${memory.id}/supersede`, 'POST', {
    supersedingStatement: 'The current approved validation experiment budget is 450 dollars.',
    expectedVersion: memory.version,
  });
  state.memoryId = corrected.replacement.id;
  await check('MAVIS human review, correction, provenance and cross-user privacy', async () => {
    const pack = await api('/mavis/context/retrieve', 'POST', {
      projectId: project.id,
      query: 'validation budget',
    });
    assert.ok(pack.approvedMemories.some((item) => item.id === corrected.replacement.id));
    assert.ok(!pack.approvedMemories.some((item) => item.id === memory.id));
    await api(`/mavis/memories/${corrected.replacement.id}`, 'GET', undefined, outsider, 404);
  });
  await check(
    'Live strategic review combines outcome metrics, corrected memory and goal-linked work',
    async () => {
      const conv = await api(`${base}/ai/conversations`, 'POST', {
        title: 'Connected strategic review',
        defaultMode: 'STRATEGY',
      });
      const answer = await api(`${base}/ai/conversations/${conv.id}/messages`, 'POST', {
        mode: 'STRATEGY',
        goalId: goal.id,
        content:
          'Review our goal. State the measured percentage and current approved experiment budget. Explain why logo polishing should be deferred in favor of interviews.',
        clientRequestId: randomUUID(),
      });
      const message = answer.assistantMessage;
      assert.equal(message.status, 'COMPLETED');
      assert.ok(/35/.test(message.content));
      assert.ok(/450/.test(message.content));
      fs.writeFileSync(path.join(output, 'strategic-review.md'), message.content);
    },
  );
  await check(
    'Fresh all-project chat recalls the second project and approved correction',
    async () => {
      const conv = await api(`${base}/ai/conversations`, 'POST', {
        title: 'Fresh cross-project recall',
        includeAllWorkspaces: true,
      });
      const answer = await api(`${base}/ai/conversations/${conv.id}/messages`, 'POST', {
        content:
          'Across our projects, what is the release codename and quality gate? What is the current approved validation experiment budget?',
        clientRequestId: randomUUID(),
      });
      assert.equal(answer.assistantMessage.status, 'COMPLETED');
      assert.match(answer.assistantMessage.content, /ORBIT.MANGO/i);
      assert.match(answer.assistantMessage.content, /42/);
      assert.match(answer.assistantMessage.content, /450/);
      fs.writeFileSync(
        path.join(output, 'cross-project-recall.md'),
        answer.assistantMessage.content,
      );
    },
  );
  await check(
    'Generated task draft requires confirmation and confirmation retry does not duplicate tasks',
    async () => {
      const draft = await api(`${base}/ai/decisions/${decision.id}/task-proposals`, 'POST', {});
      const before = await database.query(
        'SELECT count(*)::int as total FROM tasks WHERE project_id=$1',
        [project.id],
      );
      const key = randomUUID();
      const confirmed = await api(
        `${base}/ai/proposals/${draft.id}/confirm`,
        'POST',
        { version: draft.version },
        state.auth,
        undefined,
        { 'Idempotency-Key': key },
      );
      await api(
        `${base}/ai/proposals/${draft.id}/confirm`,
        'POST',
        { version: draft.version },
        state.auth,
        undefined,
        { 'Idempotency-Key': key },
      );
      const after = await database.query(
        'SELECT count(*)::int as total FROM tasks WHERE project_id=$1',
        [project.id],
      );
      assert.equal(after[0].total - before[0].total, confirmed.resultRecordIds.length);
      assert.ok(confirmed.resultRecordIds.length > 0);
      const linked = await database.query(
        'SELECT count(*)::int as total FROM tasks WHERE id=ANY($1::uuid[]) AND goal_id=$2',
        [confirmed.resultRecordIds.map((item) => item.id), goal.id],
      );
      assert.equal(
        linked[0].total,
        confirmed.resultRecordIds.length,
        'Generated tasks lost the source decision goal',
      );
    },
  );
  await check(
    'Real Hermes subprocess uses project evidence and calculator with persisted artifact',
    async () => {
      const runtime = await api(`${base}/ai/runs/runtime`);
      assert.ok(runtime.available, 'Hermes runtime unavailable');
      const run = await api(`${base}/ai/runs`, 'POST', {
        prompt:
          'Search project evidence for synthetic pricing. Use calculate_pricing with price=20, variableCost=5, fixedCost=100, units=10. Report the operating profit and cite evidence. Do not request changes.',
        idempotencyKey: randomUUID(),
      });
      const finished = await until(
        () => api(`${base}/ai/runs/${run.id}`),
        (value) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value.status),
        210000,
      );
      assert.equal(finished.status, 'SUCCEEDED', finished.errorCode || 'Runtime failed');
      assert.match(finished.artifact, /50/);
      assert.ok(
        JSON.stringify(finished.events).includes('calculate_pricing'),
        'Calculator was not called',
      );
      state.runId = run.id;
      fs.writeFileSync(path.join(output, 'hermes-artifact.md'), finished.artifact);
    },
  );
  await check('OSCAR stdio MCP connects through a real PAT and cannot promote memory', async () => {
    const pat = await api('/auth/api-keys', 'POST', {
      name: 'Connected workflow',
      expiresInDays: 1,
    });
    const token = pat.rawToken || pat.token;
    assert.ok(token, 'PAT not returned');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const client = new Client({ name: 'oscar-workflow', version: '1' });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ['-r', 'ts-node/register/transpile-only', 'scripts/mcp-server.ts'],
          cwd: process.cwd(),
          env: {
            ...process.env,
            OSCAR_API_URL: `${apiOrigin}/api/v1`,
            OSCAR_API_KEY: token,
            OSCAR_PROJECT_ID: project.id,
          },
          stderr: 'pipe',
        }),
      );
      const tools = await client.listTools();
      assert.ok(tools.tools.length > 5);
      assert.ok(!tools.tools.some((tool) => tool.name === 'mavis_review_memory'));
      const found = await client.callTool({ name: 'list_projects', arguments: {} });
      assert.ok(!found.isError);
      await api(
        `/mavis/memories/${corrected.replacement.id}/approve`,
        'POST',
        { expectedVersion: 1 },
        { cookie: '', csrf: '' },
        403,
        { Authorization: `Bearer ${token}` },
      );
    } finally {
      await client.close();
      await api(`/auth/api-keys/${pat.id}`, 'DELETE');
    }
  });
  const connection = await api('/platforms/connections', 'POST', {
    name: 'Installed T3 workflow',
    platformType: 't3',
    baseUrl: 'http://127.0.0.1:43102',
    projectId: project.id,
  });
  state.t3ConnectionId = connection.id;
  if (process.argv.includes('--authorize-t3')) {
    fs.writeFileSync(path.join(output, 'private-state.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(output, 'password.txt'), state.password);
    console.log(
      'T3 authorization stage: sign into the isolated frontend and authorize Installed T3 workflow with read-only scope. Waiting up to 10 minutes.',
    );
    await until(
      () => api(`/platforms/connections/${state.t3ConnectionId}`),
      (connection) => Boolean(connection.authToken),
      600000,
    );
  }
  fixture = await require('./lib/connected-platform-checks.cjs')({
    api,
    state,
    check,
    database,
    output,
    results,
  });
  await require('./lib/connected-feature-checks.cjs')({ api, state, check, output });
  if (process.argv.includes('--handoffs'))
    handoffFixture = await require('./lib/connected-handoff-checks.cjs')({
      api,
      state,
      check,
      results,
    });
  results.finishedAt = new Date().toISOString();
  save();
  fs.writeFileSync(path.join(output, 'private-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(output, 'password.txt'), state.password);
  console.log(
    `Workflow checks complete: ${results.checks.filter((row) => row.status === 'passed').length}/${results.checks.length} passed.`,
  );
  if (results.checks.some((row) => row.status === 'failed')) process.exitCode = 1;
  if (keep) {
    console.log('Isolated API is ready on localhost:3101 for browser and T3 consent checks.');
    await new Promise((resolve) => {
      const stopFile = path.join(output, 'stop.request');
      const poll = setInterval(() => {
        if (fs.existsSync(stopFile)) {
          clearInterval(poll);
          fs.rmSync(stopFile, { force: true });
          resolve();
        }
      }, 500);
      process.once('SIGINT', () => {
        clearInterval(poll);
        resolve();
      });
    });
  }
}
main()
  .catch((error) => {
    results.fatal = String(error.message).slice(0, 500);
    save();
    console.error('Workflow stopped:', results.fatal);
    process.exitCode = 1;
  })
  .finally(cleanup);
