import http from 'http';

interface TestResult {
  suite: string;
  name: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];
const BASE_URL = 'http://127.0.0.1:3001/api/v1';

async function request(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: any;
    cookies?: string[];
  } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; cookies: string[] }> {
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
  const payload = options.body
    ? typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)
    : null;

  const headers: Record<string, string> = {
    ...options.headers,
  };

  if (payload && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (payload) {
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  if (options.cookies && options.cookies.length > 0) {
    headers['Cookie'] = options.cookies.join('; ');
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsed: any = rawData;
          try {
            parsed = JSON.parse(rawData);
          } catch {}

          const rawCookies = res.headers['set-cookie'];
          const extractedCookies: string[] = rawCookies
            ? (Array.isArray(rawCookies) ? rawCookies : [rawCookies])
                .filter((c): c is string => typeof c === 'string')
                .map((c) => c.split(';')[0] || '')
                .filter((c) => c.length > 0)
            : [];

          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
            cookies: extractedCookies,
          });
        });
      },
    );

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function extractCsrfToken(cookies: string[]): string | undefined {
  for (const c of cookies) {
    if (c.startsWith('csrf_token=')) {
      return decodeURIComponent(c.substring('csrf_token='.length));
    }
  }
  return undefined;
}

async function runTest(suite: string, name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({
      suite,
      name,
      status: 'PASS',
      durationMs: Date.now() - start,
    });
    console.log(`  ✓ [${suite}] ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({
      suite,
      name,
      status: 'FAIL',
      durationMs: Date.now() - start,
      error: err.message || String(err),
      details: err.details,
    });
    console.error(`  ✗ [${suite}] ${name}:`, err.message || err);
  }
}

function assert(condition: boolean, message: string, details?: any) {
  if (!condition) {
    const error: any = new Error(message);
    if (details) error.details = details;
    throw error;
  }
}

async function main() {
  console.log('=== STARTING COMPREHENSIVE LIVE BACKEND API TEST SUITE ===\n');

  let aliceCookies: string[] = [];
  let aliceCsrf = '';
  let adminCookies: string[] = [];
  let adminCsrf = '';
  let aiwProjectId = '';
  let createdTaskId = '';
  let createdDecisionId = '';

  // 1. AUTHENTICATION & SESSION
  console.log('\n--- 1. Authentication & Session ---');
  await runTest('Auth', 'Login with invalid email format', async () => {
    const res = await request('POST', '/auth/login', {
      body: { email: 'invalid-email', password: 'Password123!' },
    });
    assert(res.status === 400, `Expected 400 but got ${res.status}`);
  });

  await runTest('Auth', 'Login with wrong password', async () => {
    const res = await request('POST', '/auth/login', {
      body: { email: 'alice@example.com', password: 'WrongPassword123!' },
    });
    assert(res.status === 401, `Expected 401 but got ${res.status}`, res.body);
  });

  await runTest('Auth', 'Login as alice@example.com successfully', async () => {
    const res = await request('POST', '/auth/login', {
      body: { email: 'alice@example.com', password: 'Password123!' },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`, res.body);
    assert(
      res.body.data && res.body.data.user.email === 'alice@example.com',
      'User email mismatch',
    );
    aliceCookies = res.cookies;
    aliceCsrf = res.body?.data?.csrfToken || extractCsrfToken(aliceCookies) || '';
    assert(aliceCsrf.length > 0, 'CSRF token not found in login response or cookies');
  });

  await runTest('Auth', 'Get /auth/me for Alice', async () => {
    const res = await request('GET', '/auth/me', { cookies: aliceCookies });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.email === 'alice@example.com', 'User mismatch');
  });

  await runTest('Auth', 'CSRF Protection: POST without x-csrf-token is rejected', async () => {
    const res = await request('POST', '/projects', {
      cookies: aliceCookies,
      body: { key: 'TEST', name: 'Test' },
    });
    assert(res.status === 403, `Expected 403 CSRF rejection but got ${res.status}`);
  });

  await runTest('Auth', 'CSRF Protection: POST with invalid x-csrf-token is rejected', async () => {
    const res = await request('POST', '/projects', {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': 'invalid-token-12345' },
      body: { key: 'TEST', name: 'Test' },
    });
    assert(res.status === 403, `Expected 403 CSRF rejection but got ${res.status}`);
  });

  await runTest('Auth', 'Login as admin@example.com successfully', async () => {
    const res = await request('POST', '/auth/login', {
      body: { email: 'admin@example.com', password: 'Password123!' },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    adminCookies = res.cookies;
    adminCsrf = res.body?.data?.csrfToken || extractCsrfToken(adminCookies) || '';
    assert(adminCsrf.length > 0, 'Admin CSRF token missing');
  });

  // 2. PROJECTS WORKSPACE
  console.log('\n--- 2. Projects Workspace ---');
  await runTest('Projects', 'List user projects for Alice', async () => {
    const res = await request('GET', '/projects', { cookies: aliceCookies });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(Array.isArray(res.body.data), 'Expected data to be array');
    const aiw = res.body.data.find((p: any) => p.key === 'AIW');
    assert(aiw !== undefined, 'Project AIW not found in user projects');
    aiwProjectId = aiw.id;
  });

  await runTest('Projects', 'Get project details for AIW', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}`, { cookies: aliceCookies });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.key === 'AIW', 'Key mismatch');
  });

  await runTest(
    'Projects',
    'Get project with invalid UUID format returns 404 (privacy contract)',
    async () => {
      const res = await request('GET', '/projects/not-a-valid-uuid', { cookies: aliceCookies });
      assert(res.status === 404, `Expected 404 for bad UUID format but got ${res.status}`);
    },
  );

  await runTest('Projects', 'Get non-existent project UUID returns 404', async () => {
    const res = await request('GET', '/projects/00000000-0000-0000-0000-000000000000', {
      cookies: aliceCookies,
    });
    assert(res.status === 404, `Expected 404 for missing project but got ${res.status}`);
  });

  await runTest('Projects', 'Reject project creation with duplicate key', async () => {
    const res = await request('POST', '/projects', {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { key: 'AIW', name: 'Duplicate AIW' },
    });
    assert(res.status === 409, `Expected 409 for duplicate key but got ${res.status}`);
  });

  await runTest(
    'Projects',
    'Reject project creation with invalid key (contains symbols)',
    async () => {
      const res = await request('POST', '/projects', {
        cookies: aliceCookies,
        headers: { 'x-csrf-token': aliceCsrf },
        body: { key: 'BAD@KEY', name: 'Invalid Project' },
      });
      assert(res.status === 400, `Expected 400 for invalid key but got ${res.status}`);
    },
  );

  await runTest('Projects', 'List project members for AIW', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/members`, {
      cookies: aliceCookies,
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(Array.isArray(res.body.data) && res.body.data.length > 0, 'Expected members');
  });

  await runTest('Projects', 'Search member candidates for AIW', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/member-candidates?search=admin`, {
      cookies: aliceCookies,
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(Array.isArray(res.body.data), 'Expected array');
  });

  // 3. DASHBOARD
  console.log('\n--- 3. Dashboard ---');

  // 4. TASKS (KANBAN & LIST)
  console.log('\n--- 4. Tasks ---');
  await runTest('Tasks', 'List project tasks for AIW', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/tasks`, { cookies: aliceCookies });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(Array.isArray(res.body.data), 'Expected tasks array');
  });

  await runTest('Tasks', 'Filter tasks by status TODO and priority HIGH', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/tasks?status=TODO&priority=HIGH`, {
      cookies: aliceCookies,
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    for (const t of res.body.data) {
      assert(t.status === 'TODO', 'Filter status mismatch');
      assert(t.priority === 'HIGH', 'Filter priority mismatch');
    }
  });

  await runTest('Tasks', 'Create a new task with full metadata', async () => {
    const res = await request('POST', `/projects/${aiwProjectId}/tasks`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: {
        title: 'E2E Automated Live Verification Task',
        description: 'Testing full lifecycle status transitions and edge cases',
        priority: 'HIGH',
        status: 'TODO',
        dueDate: '2026-10-15',
      },
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}`);
    assert(res.body.data.id !== undefined, 'Created task missing id');
    createdTaskId = res.body.data.id;
  });

  await runTest('Tasks', 'Status transition: TODO -> IN_PROGRESS', async () => {
    const res = await request('PATCH', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { status: 'IN_PROGRESS', version: 1 },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.status === 'IN_PROGRESS', 'Status not IN_PROGRESS');
  });

  await runTest('Tasks', 'Status transition: IN_PROGRESS -> IN_REVIEW', async () => {
    const res = await request('PATCH', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { status: 'IN_REVIEW', version: 2 },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.status === 'IN_REVIEW', 'Status not IN_REVIEW');
  });

  await runTest('Tasks', 'Status transition: IN_REVIEW -> BLOCKED with blockedReason', async () => {
    const res = await request('PATCH', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { status: 'BLOCKED', blockedReason: 'Awaiting dependency upgrade', version: 3 },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.status === 'BLOCKED', 'Status not BLOCKED');
    assert(res.body.data.blockedReason === 'Awaiting dependency upgrade', 'blockedReason mismatch');
  });

  await runTest('Tasks', 'Status transition: BLOCKED -> DONE clears blockedReason', async () => {
    const res = await request('PATCH', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { status: 'DONE', version: 4 },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.status === 'DONE', 'Status not DONE');
    assert(!res.body.data.blockedReason, 'blockedReason was not cleared');
  });

  await runTest(
    'Tasks',
    'Optimistic concurrency: update with stale version returns 409',
    async () => {
      const res = await request('PATCH', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
        cookies: aliceCookies,
        headers: { 'x-csrf-token': aliceCsrf },
        body: { title: 'Conflicting Edit', version: 1 },
      });
      assert(res.status === 409, `Expected 409 Conflict but got ${res.status}`);
    },
  );

  await runTest('Tasks', 'Reject task creation with non-existent assignee UUID', async () => {
    const res = await request('POST', `/projects/${aiwProjectId}/tasks`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: {
        title: 'Task with ghost assignee',
        assigneeId: '00000000-0000-0000-0000-000000000000',
      },
    });
    assert(res.status === 400 || res.status === 404, `Expected 400/404 but got ${res.status}`);
  });

  // 5. REQUIREMENTS
  console.log('\n--- 5. Requirements ---');

  // 6. DECISIONS (ADRs)
  console.log('\n--- 6. Decisions ---');
  await runTest('Decisions', 'List decisions for AIW', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/decisions`, {
      cookies: aliceCookies,
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(Array.isArray(res.body.data), 'Expected array');
  });

  await runTest('Decisions', 'Create decision', async () => {
    const res = await request('POST', `/projects/${aiwProjectId}/decisions`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: {
        title: 'Adopt Playwright and Jest for Full Quality Suite',
        decisionText: 'Use Playwright for Chromium and Jest for e2e',
        rationale: 'Zero regression safety net across all layers',
      },
    });
    assert(res.status === 201, `Expected 201 but got ${res.status}`);
    createdDecisionId = res.body.data.id;
  });

  await runTest('Decisions', 'Update decision status: PROPOSED -> ACCEPTED', async () => {
    const res = await request('PATCH', `/projects/${aiwProjectId}/decisions/${createdDecisionId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { status: 'ACCEPTED', version: 1 },
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data.status === 'ACCEPTED', 'Status not ACCEPTED');
  });

  // 7. MEETINGS
  console.log('\n--- 7. Meetings ---');

  // 8. DOCUMENTS
  console.log('\n--- 8. Documents ---');
  await runTest('Documents', 'List documents for AIW', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/documents`, {
      cookies: aliceCookies,
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(Array.isArray(res.body.data), 'Expected array');
  });

  // 9. SEARCH
  console.log('\n--- 9. Search ---');
  await runTest('Search', 'Unified keyword search across entities', async () => {
    const res = await request('GET', `/projects/${aiwProjectId}/search?q=Architecture`, {
      cookies: aliceCookies,
    });
    assert(res.status === 200, `Expected 200 but got ${res.status}`);
    assert(res.body.data !== undefined, 'Missing data in search response');
  });

  await runTest('Search', 'Unified search with SQL injection attempt', async () => {
    const res = await request(
      'GET',
      `/projects/${aiwProjectId}/search?q=${encodeURIComponent("' OR 1=1 --")}`,
      { cookies: aliceCookies },
    );
    assert(res.status === 200, `Expected 200 safe handling but got ${res.status}`);
  });

  await runTest('Search', 'Unified search with special chars and regex tokens', async () => {
    const res = await request(
      'GET',
      `/projects/${aiwProjectId}/search?q=${encodeURIComponent('!@#$%^&*()_+{}[]:;<>?')}`,
      { cookies: aliceCookies },
    );
    assert(res.status === 200, `Expected 200 safe handling but got ${res.status}`);
  });

  // 10. EDGE CASES & PRIVACY ISOLATION
  console.log('\n--- 10. Edge Cases & Privacy Isolation ---');
  await runTest('Privacy', 'Accessing non-existent project returns 404', async () => {
    const res = await request('GET', '/projects/12345678-1234-1234-1234-123456789abc/tasks', {
      cookies: aliceCookies,
    });
    assert(res.status === 404, `Expected 404 but got ${res.status}`);
  });

  await runTest('Edge Cases', 'Empty or whitespace task title is rejected on create', async () => {
    const res = await request('POST', `/projects/${aiwProjectId}/tasks`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { title: '     ' },
    });
    assert(res.status === 400, `Expected 400 for whitespace title but got ${res.status}`);
  });

  await runTest('Edge Cases', 'Empty or whitespace task title is rejected on update', async () => {
    const res = await request('PATCH', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
      body: { version: 5, title: '     ' },
    });
    assert(
      res.status === 400,
      `Expected 400 for whitespace task title update but got ${res.status}`,
    );
  });

  await runTest(
    'Edge Cases',
    'Empty or whitespace decision title/text is rejected on update',
    async () => {
      const res = await request(
        'PATCH',
        `/projects/${aiwProjectId}/decisions/${createdDecisionId}`,
        {
          cookies: aliceCookies,
          headers: { 'x-csrf-token': aliceCsrf },
          body: { version: 2, title: '     ' },
        },
      );
      assert(
        res.status === 400,
        `Expected 400 for whitespace decision title update but got ${res.status}`,
      );
    },
  );

  await runTest(
    'Edge Cases',
    'Empty or whitespace project name is rejected on update',
    async () => {
      const res = await request('PATCH', `/projects/${aiwProjectId}`, {
        cookies: aliceCookies,
        headers: { 'x-csrf-token': aliceCsrf },
        body: { name: '     ' },
      });
      assert(
        res.status === 400,
        `Expected 400 for whitespace project name update but got ${res.status}`,
      );
    },
  );

  await runTest('Edge Cases', 'Reject corrupted binary PDF file upload with 415', async () => {
    const boundary = '----WebKitFormBoundaryCorruptedPdf123';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="corrupted.pdf"',
      'Content-Type: application/pdf',
      '',
      'THIS_IS_NOT_A_VALID_PDF_HEADER_IT_LACKS_PERCENT_PDF',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const res = await request('POST', `/projects/${aiwProjectId}/documents`, {
      cookies: aliceCookies,
      headers: {
        'x-csrf-token': aliceCsrf,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: payload,
    });
    assert(res.status === 415, `Expected 415 for corrupted PDF header but got ${res.status}`);
  });

  await runTest('Edge Cases', 'Rapid consecutive requests test (concurrency)', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      request('GET', `/projects/${aiwProjectId}/tasks?page=1&pageSize=10`, {
        cookies: aliceCookies,
      }),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      assert(r.status === 200, `Expected 200 on concurrent read but got ${r.status}`);
    }
  });

  // Clean up created entities
  if (createdTaskId) {
    await request('DELETE', `/projects/${aiwProjectId}/tasks/${createdTaskId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
    });
  }
  if (createdDecisionId) {
    await request('DELETE', `/projects/${aiwProjectId}/decisions/${createdDecisionId}`, {
      cookies: aliceCookies,
      headers: { 'x-csrf-token': aliceCsrf },
    });
  }

  // Summary
  console.log('\n=== TEST RUN SUMMARY ===');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    console.error('\nFAILED TESTS:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.error(`- [${r.suite}] ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL LIVE API TESTS PASSED SUCCESSFULLY!');
  }
}

main().catch((e) => {
  console.error('Fatal error in test suite:', e);
  process.exit(1);
});
