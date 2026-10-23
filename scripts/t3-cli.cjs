// Run with T3's Electron executable and ELECTRON_RUN_AS_NODE=1.
// Calling the bundled CLI directly avoids Electron's import.meta.main mismatch.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const [serverDirectory, ...args] = process.argv.slice(2);
if (!serverDirectory || !path.isAbsolute(serverDirectory)) {
  throw new Error('An absolute installed T3 server directory is required.');
}
const entry = fs.readdirSync(serverDirectory).filter((name) => /^binCli-[\w-]+\.mjs$/.test(name));
if (entry.length !== 1) throw new Error('Installed T3 CLI layout changed.');
process.argv = [process.execPath, path.join(serverDirectory, 'bin.mjs'), ...args];
import(pathToFileURL(path.join(serverDirectory, entry[0])).href)
  .then(({ runCli }) => runCli())
  .catch(() => {
    console.error('T3 CLI could not complete.');
    process.exitCode = 1;
  });
