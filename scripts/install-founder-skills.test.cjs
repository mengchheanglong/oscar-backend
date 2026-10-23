const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSkills, install, SOURCE } = require('./install-founder-skills.cjs');
const read = (file) =>
  file === 'LICENSE'
    ? 'MIT License\nCopyright Jake Schincariol\nPermission fixture.'
    : file.endsWith('SKILL.md')
      ? `---\nname: ${file.split('/')[1]}\n---\nOriginal instructions in full.`
      : 'Supporting reference data.';
test('preserves all 11 originals, references, attribution and runtime boundaries', () => {
  const rows = buildSkills(read);
  assert.equal(rows.length, 11);
  assert.equal(new Set(rows.map((r) => r.slug)).size, 11);
  for (const row of rows) {
    assert.match(row.instructions, /Original instructions in full/);
    assert.match(row.instructions, /Copyright Jake Schincariol/);
    assert.match(row.instructions, /NOT installed as OSCAR chat tools/);
    assert.ok(row.instructions.length <= 12000);
  }
  assert.match(rows[0].instructions, /Bundled reference: skills\/founder-board\/lenses.md/);
});
test('rejects oversized or mismatched content rather than silently truncating it', () => {
  assert.throws(
    () => buildSkills((file) => (file.endsWith('lenses.md') ? 'x'.repeat(12000) : read(file))),
    /exceeds/,
  );
  assert.throws(
    () => buildSkills((file) => (file === 'LICENSE' ? 'Unknown license' : read(file))),
    /license/,
  );
});
test('retries without duplicates and preserves user-authored slug collisions', async () => {
  const stored = [];
  let writes = 0;
  const request = async (route, method = 'GET', body) => {
    if (method === 'POST') {
      stored.push({ ...body, id: String(stored.length), version: 1 });
      writes++;
      return stored.at(-1);
    }
    if (route === '/skills') return stored;
    return stored.find((s) => route.endsWith('/' + s.id));
  };
  const rows = buildSkills(read);
  assert.equal((await install(rows, request)).installed, 11);
  assert.equal((await install(rows, request)).unchanged, 11);
  assert.equal(writes, 11);
  stored[0].instructions = 'My own version';
  await assert.rejects(install(rows, request), /user-authored/);
  assert.equal(stored[0].instructions, 'My own version');
  assert.ok(rows[0].instructions.startsWith(`Source: ${SOURCE}`));
});
