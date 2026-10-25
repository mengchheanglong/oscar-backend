// Establish a separate local scope signing key. Never prints credentials or user data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const backendPath = path.join(root, '.env');
const knowledgePath = path.resolve(root, '../oscar-knowledge/.env');
function update(file, values) {
  let content = fs.readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const expression = new RegExp(`^${key}=.*$`, 'm');
    content = expression.test(content)
      ? content.replace(expression, `${key}=${value}`)
      : `${content.trimEnd()}\n${key}=${value}\n`;
  }
  fs.writeFileSync(file, content);
}
async function main() {
  const backend = dotenv.parse(fs.readFileSync(backendPath));
  const knowledge = dotenv.parse(fs.readFileSync(knowledgePath));
  const target = new URL(backend.DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) &&
      target.port === '43104' &&
      target.pathname === '/oscar',
  );
  assert(backend.OSCAR_KNOWLEDGE_SERVICE_TOKEN === knowledge.KNOWLEDGE_SERVICE_TOKEN);
  const existing = knowledge.KNOWLEDGE_PRIVATE_SCOPE_SECRET;
  const key = existing || randomBytes(48).toString('hex');
  assert(key.length >= 32 && key !== knowledge.KNOWLEDGE_SERVICE_TOKEN);
  const response = await fetch('http://127.0.0.1:43101/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${backend.AI_WORKSPACE_API_KEY}` },
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok);
  const envelope = await response.json();
  const user = envelope.data ?? envelope;
  const owner = user.id ?? user.user?.id;
  assert(/^[0-9a-f-]{36}$/i.test(owner));
  const catalog = 'D:/AI/OSCAR/Knowledge/Catalog';
  assert(fs.existsSync(path.join(catalog, 'library.json')));
  const approvalPath = path.join(catalog, 'private-use-approval.json');
  const priorApproval = fs.existsSync(approvalPath)
    ? JSON.parse(fs.readFileSync(approvalPath))
    : null;
  assert(!priorApproval || priorApproval.owner_id === owner, 'OWNER_CHANGE_REQUIRES_REVIEW');
  const knowledgeDb = new URL(knowledge.KNOWLEDGE_DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1'].includes(knowledgeDb.hostname) &&
      knowledgeDb.port === '43114' &&
      knowledgeDb.pathname === '/knowledge',
  );
  if (process.argv.includes('--check')) {
    assert(existing && backend.OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET === key);
    console.log('PASS: independent private scope key and ordinary local authentication');
    return;
  }
  update(knowledgePath, { KNOWLEDGE_PRIVATE_SCOPE_SECRET: key });
  update(backendPath, { OSCAR_KNOWLEDGE_PRIVATE_SCOPE_SECRET: key });
  const approveOwned = process.argv.includes('--approve-owned-pdfs');
  const inventory = approveOwned
    ? JSON.parse(fs.readFileSync(path.join(catalog, 'library.json'), 'utf8'))
    : null;
  const approvedChecksums = approveOwned
    ? Object.fromEntries(
        inventory.resources
          .filter(
            (r) =>
              r.format === 'pdf' &&
              r.presence === 'PRESENT' &&
              path.resolve(r.root).toLowerCase() ===
                path.resolve('D:/AI/OSCAR/Knowledge').toLowerCase(),
          )
          .map((r) => [r.id, r.sha256]),
      )
    : null;
  if (approveOwned)
    fs.writeFileSync(
      approvalPath,
      JSON.stringify(
        {
          owner_id: owner,
          approved_at: new Date().toISOString(),
          evidence:
            'Operator explicitly approved local indexing, private retrieval and bounded assistant context for the listed owned PDF checksums.',
          approved_pdf_checksums: {
            ...(priorApproval?.approved_pdf_checksums ?? {}),
            ...approvedChecksums,
          },
          intended_uses: ['local_index', 'private_retrieval', 'bounded_assistant_context'],
          shared_retrieval_authorized: false,
          commercial_redistribution_authorized: false,
          scope:
            'Existing Knowledge PDF files; new acquisitions retain their individual source notices.',
        },
        null,
        2,
      ),
    );
  console.log(
    'Configured independent local private scope key. Source approvals remain unchanged unless --approve-owned-pdfs was explicit. Restart backend and Knowledge API.',
  );
}
main().catch(() => {
  console.error('PRIVATE_LIBRARY_CONNECTION_FAILED: inspect local settings privately');
  process.exitCode = 1;
});
