// Configure only the isolated local installation; never print the service token.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const backendRoot = path.resolve(__dirname, '..');
const environmentPath = path.join(backendRoot, '.env');

async function main() {
  const original = fs.readFileSync(environmentPath, 'utf8');
  const backend = dotenv.parse(original);
  const collectionIndex = process.argv.indexOf('--collection');
  const collection =
    collectionIndex >= 0
      ? process.argv[collectionIndex + 1]
      : backend.OSCAR_KNOWLEDGE_COLLECTION || 'mba-business';
  if (!collection || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(collection))
    throw new Error('INVALID_KNOWLEDGE_COLLECTION');
  const database = new URL(backend.DATABASE_URL);
  if (
    !['127.0.0.1', 'localhost'].includes(database.hostname) ||
    database.port !== '43104' ||
    database.pathname !== '/oscar'
  )
    throw new Error('LOCAL_DATABASE_REQUIRED');
  const knowledge = dotenv.parse(
    fs.readFileSync(path.join(backendRoot, '../oscar-knowledge/.env')),
  );
  const token = knowledge.KNOWLEDGE_SERVICE_TOKEN;
  if (!token || token.length < 24) throw new Error('KNOWLEDGE_TOKEN_REQUIRED');
  const response = await fetch('http://127.0.0.1:8010/internal/v1/collections', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('KNOWLEDGE_AUTH_OR_READINESS_FAILED');
  const catalog = await response.json();
  if (!Array.isArray(catalog) || !catalog.some((entry) => entry.id === collection))
    throw new Error('KNOWLEDGE_COLLECTION_REQUIRED');
  const desired = {
    OSCAR_KNOWLEDGE_ENABLED: 'true',
    OSCAR_KNOWLEDGE_BASE_URL: 'http://127.0.0.1:8010',
    OSCAR_KNOWLEDGE_SERVICE_TOKEN: token,
    OSCAR_KNOWLEDGE_COLLECTION: collection,
    OSCAR_KNOWLEDGE_TIMEOUT_MS: '2500',
  };
  if (process.argv.includes('--check')) {
    if (Object.entries(desired).some(([key, value]) => backend[key] !== value))
      throw new Error('KNOWLEDGE_LOCAL_CONFIG_MISMATCH');
    console.log('PASS: local knowledge configuration, authentication and collection');
    return;
  }
  let result = original;
  for (const [key, value] of Object.entries(desired)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    result = pattern.test(result)
      ? result.replace(pattern, () => line)
      : result.replace(/\s*$/, '') + '\n' + line + '\n';
  }
  fs.writeFileSync(environmentPath, result, { mode: 0o600 });
  console.log(
    'PASS: local knowledge connected; token copied privately. Restart the local backend to apply.',
  );
}

main().catch(() => {
  console.error(
    'KNOWLEDGE_CONNECTION_FAILED: check the isolated local database, sibling knowledge .env and healthy API on port 8010. No credentials logged.',
  );
  process.exitCode = 1;
});
