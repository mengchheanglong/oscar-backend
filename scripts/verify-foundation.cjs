const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const backend = path.resolve(__dirname, '..');
const frontend =
  ['oscar-frontend', 'continuum-frontend']
    .map((name) => path.resolve(backend, '..', name))
    .find((directory) => fs.existsSync(path.join(directory, 'package.json'))) ??
  path.resolve(backend, '../oscar-frontend');
const flags = new Set(process.argv.slice(2));
const allowed = new Set(['--integration', '--live', '--help']);
if ([...flags].some((flag) => !allowed.has(flag))) {
  console.error('Unknown option. Run pnpm verify:foundation --help.');
  process.exit(1);
}
if (flags.has('--help')) {
  console.log(`Usage: pnpm verify:foundation [--integration] [--live]

Verifies the backend and sibling oscar-frontend checkout.
The existing continuum-frontend local folder name is also supported.
--integration  Also run PostgreSQL regressions against the local Compose test DB.
               Start it first with pnpm db:test:up. Development data is not used.
--live         Also check the local web, API, and web-to-API proxy health.

Writes a report without credentials or test output to var/foundation/latest.json.
Does not start services, call paid AI providers, or migrate the development DB.`);
  process.exit(0);
}

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: 'running',
  runtime: { node: process.versions.node, pnpm: null },
  repositories: {},
  migrations: [],
  steps: [],
};
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Git metadata could not be read.');
  return result.stdout.trim();
}
function run(name, cwd, args, env = process.env) {
  console.log(`\nFoundation: ${name}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd,
    env,
    stdio: 'inherit',
  });
  const passed = result.status === 0;
  report.steps.push({
    name,
    status: passed ? 'passed' : 'failed',
    durationMs: Date.now() - started,
  });
  if (!passed) throw new Error(`${name} failed. See the command output above.`);
}
async function live(name, url) {
  const started = Date.now();
  let passed = false;
  let statusCode = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    statusCode = response.status;
    passed = response.ok;
    await response.body?.cancel();
  } catch {
    // Do not persist raw connection errors or response bodies.
  }
  report.steps.push({
    name,
    status: passed ? 'passed' : 'failed',
    statusCode,
    durationMs: Date.now() - started,
  });
  if (!passed) throw new Error(`${name} failed. Start the local app and retry.`);
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 14) throw new Error('Use Node 24.14.0 or a later Node 24 release.');
  if (!process.env.npm_execpath || !fs.existsSync(process.env.npm_execpath)) {
    throw new Error('Run this command through pnpm verify:foundation.');
  }
  const packageManager = spawnSync(process.execPath, [process.env.npm_execpath, '--version'], {
    encoding: 'utf8',
  });
  report.runtime.pnpm = packageManager.stdout?.trim() || null;
  if (packageManager.status !== 0 || report.runtime.pnpm !== '10.32.1') {
    throw new Error('Use the pinned pnpm 10.32.1 package manager.');
  }
  for (const [name, cwd] of Object.entries({ backend, frontend })) {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    report.repositories[name] = {
      revision: git(cwd, ['rev-parse', 'HEAD']),
      branch: git(cwd, ['branch', '--show-current']),
      dirtyAtStart: git(cwd, ['status', '--porcelain']).length > 0,
      packageManager: pkg.packageManager,
    };
  }
  const migrations = path.join(backend, 'src/database/migrations');
  report.migrations = fs
    .readdirSync(migrations)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => ({ name, sha256: hash(path.join(migrations, name)) }));

  for (const command of ['format:check', 'lint', 'typecheck', 'test', 'test:e2e', 'build']) {
    run(`backend:${command}`, backend, [command]);
  }
  const contract = path.join(backend, 'docs/api/openapi.json');
  const before = hash(contract);
  run('backend:openapi:generate', backend, ['openapi:generate']);
  const stable = before === hash(contract);
  report.steps.push({ name: 'backend:openapi-stability', status: stable ? 'passed' : 'failed' });
  if (!stable)
    throw new Error('OpenAPI changed during generation. Review the regenerated contract.');

  if (flags.has('--integration')) {
    run('backend:test:integration', backend, ['test:integration'], {
      ...process.env,
      TEST_DATABASE_URL:
        'postgresql://ai_workspace_test:local_test_only@127.0.0.1:55433/ai_workspace_test',
    });
  }
  for (const command of ['lint', 'typecheck', 'test', 'build']) {
    run(`frontend:${command}`, frontend, [command]);
  }
  if (flags.has('--live')) {
    await live('live:web', 'http://127.0.0.1:3002/');
    await live('live:api', 'http://127.0.0.1:3001/api/v1/health/ready');
    await live('live:proxy', 'http://127.0.0.1:3002/api/v1/health/ready');
  }
}

main()
  .then(() => {
    report.status = 'passed';
  })
  .catch((error) => {
    report.status = 'failed';
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    const directory = path.join(backend, 'var/foundation');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nFoundation ${report.status}. Report: var/foundation/latest.json`);
  });
