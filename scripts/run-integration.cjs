require('dotenv').config({ quiet: true });
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');

async function run() {
  const value = process.env.TEST_DATABASE_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    /* Report configuration without exposing values. */
  }
  if (
    !url ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.pathname.endsWith('_test') ||
    value === process.env.DATABASE_URL
  ) {
    throw new Error(
      'Set TEST_DATABASE_URL to a dedicated PostgreSQL database ending in _test, distinct from DATABASE_URL.',
    );
  }
  const name = `oscar_integration_${process.pid}_${randomBytes(4).toString('hex')}_test`;
  if (!/^oscar_integration_[0-9]+_[a-f0-9]+_test$/.test(name))
    throw new Error('Invalid generated test database name.');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  let created = false,
    exitCode = 1;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const isolatedUrl = new URL(url);
    isolatedUrl.pathname = `/${name}`;
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('jest/bin/jest'),
        '--config',
        'jest.config.cjs',
        '--selectProjects',
        'integration',
        '--runInBand',
        '--testTimeout',
        '30000',
        ...process.argv.slice(2),
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: isolatedUrl.toString(),
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-vm-modules`,
        },
      },
    );
    exitCode = result.status ?? 1;
  } finally {
    // Only this run's generated database is removed; the configured test database is retained.
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
  process.exitCode = exitCode;
}
run().catch(() => {
  console.error(
    'Integration run failed. Verify TEST_DATABASE_URL and CREATE DATABASE permission on its isolated test server. Credentials are not logged.',
  );
  process.exitCode = 1;
});
