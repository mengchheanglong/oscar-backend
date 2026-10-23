const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
let valid = false;
try {
  const url = new URL(process.env.DATABASE_URL);
  valid =
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.port === '43104' &&
    url.pathname === '/oscar';
} catch {
  /* Never print a malformed URL or its credentials. */
}
if (!valid) {
  console.error('Startup requires the isolated local oscar database on port 43104.');
  process.exitCode = 1;
}
