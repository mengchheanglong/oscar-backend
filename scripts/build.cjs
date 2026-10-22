const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist')
  throw new Error('Invalid build output path');
// Renamed modules must not survive as stale entity/controller files in local builds.
fs.rmSync(output, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  { cwd: root, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
