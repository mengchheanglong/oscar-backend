require('dotenv').config({ quiet: true });
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');

const value = process.env.TEST_DATABASE_URL;
let url;
try {
  url = new URL(value);
} catch {
  /* A clear error is emitted below. */
}
if (
  !url ||
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !url.pathname.endsWith('_test') ||
  value === process.env.DATABASE_URL
) {
  console.error(
    'Set TEST_DATABASE_URL to a dedicated PostgreSQL database ending in _test, distinct from DATABASE_URL.',
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    require.resolve('jest/bin/jest'),
    '--config',
    'jest.config.cjs',
    '--selectProjects',
    'integration',
    '--runInBand',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: value,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --experimental-vm-modules`,
    },
  },
);
process.exit(result.status ?? 1);
