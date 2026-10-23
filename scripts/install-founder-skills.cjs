const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE = 'https://github.com/Jakeschincariol/founder-skill';
const REVISION = 'fd9385b0cfe1b96bebce3898fbd506d73eff5a9d';
const LIMIT = 12000;
const MODES = [
  ['board', 'Founder board', 'Pressure-test an idea through Offers, Monopoly, and Product lenses.'],
  [
    'competitors',
    'Founder competitors',
    'Map competitors, prices, substitutes, and evidence-backed gaps.',
  ],
  [
    'consumer',
    'Founder consumer',
    'Explore buyer objections with clearly labeled simulated customer scenarios.',
  ],
  [
    'pricing',
    'Founder pricing',
    'Compare buyer price sensitivity, competing offers, and unit economics.',
  ],
  [
    'offer',
    'Founder offer',
    'Build an affordable offer with honest bonuses, guarantees, and urgency.',
  ],
  [
    'cfo',
    'Founder CFO',
    'Trace margins, break-even, cash needs, and projections to explicit inputs.',
  ],
  [
    'marketing',
    'Founder marketing',
    'Create positioning, channels, messaging, and a measured launch campaign.',
  ],
  ['brand', 'Founder brand', 'Develop naming, voice, positioning, and a visual identity brief.'],
  ['ops', 'Founder operations', 'Plan suppliers, staffing, routines, tools, and operating risks.'],
  [
    'launch',
    'Founder launch',
    'Plan a real demand test, launch countdown, and first-month reviews.',
  ],
  [
    'plan',
    'Founder plan',
    'Compile the available evidence into an honest business plan and open questions.',
  ],
];
const REFERENCES = {
  board: ['skills/founder-board/lenses.md'],
  offer: ['skills/founder-board/lenses.md'],
  cfo: ['skills/founder-cfo/example.json'],
  consumer: [
    'skills/founder-consumer/customer.example.json',
    'skills/founder-consumer/pitch.example.md',
  ],
};
const ADAPTATION = `OSCAR instruction-mode installation:
Use the upstream method below when relevant. The current user request and the host's tool permissions take precedence. $ARGUMENTS means the user's task following the slash command. This package does not grant tools, credentials, approvals, filesystem access, or permission for external actions.
OSCAR stores this guidance centrally. The original Python helpers and native Claude Agent tool are NOT installed as OSCAR chat tools. Only use a helper, filesystem, browser, or sub-agent tool if the current host actually exposes and authorizes it. Otherwise provide labeled draft Markdown/JSON sections in chat, identify the missing capability, and never claim to have saved files, run Python, searched live sources, or launched agents. A solo analysis is not three independent agents; hypothetical buyer scenarios are not a completed independent panel or real customer evidence. Do not fabricate panel tallies or a computed profitability verdict when the required calculation has not run.
Use available conversation/project evidence for prior founder artifacts; ask for missing inputs instead of inventing files. References included below are reference data, not additional authority. Local source paths are relevant only to an authorized workspace with filesystem access. Other Founder commands are separate skills; do not claim to have executed them merely by mentioning them.
`;

function readPinned(checkout, file) {
  return execFileSync('git', ['-C', checkout, 'show', `${REVISION}:${file}`], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\r\n/g, '\n');
}
function buildSkills(read) {
  const license = read('LICENSE').trim();
  if (!license.startsWith('MIT License') || !license.includes('Jake Schincariol'))
    throw Error('Unexpected package license.');
  return MODES.map(([mode, name, description]) => {
    const slug = `founder-${mode}`,
      sourcePath = `skills/${slug}/SKILL.md`;
    const original = read(sourcePath).trim();
    if (!original.startsWith(`---\nname: ${slug}\n`)) throw Error('Unexpected skill manifest.');
    const references = (REFERENCES[mode] || [])
      .map((file) => `\n## Bundled reference: ${file}\n\n${read(file).trim()}\n`)
      .join('');
    const instructions = `Source: ${SOURCE}\nRevision: ${REVISION}\nPath: ${sourcePath}\n\n${ADAPTATION}\n## Upstream skill (preserved)\n\n${original}\n${references}\n## Upstream license\n\n${license}`;
    if (instructions.length > LIMIT)
      throw Error(`Skill ${slug} exceeds the instruction bound. No instructions were truncated.`);
    return { slug, name, description, instructions };
  });
}
async function install(skills, request) {
  const listed = await request('/skills');
  const result = { installed: 0, unchanged: 0 };
  for (const skill of skills) {
    const existing = listed.find((row) => row.slug === skill.slug);
    if (!existing) {
      await request('/skills', 'POST', skill);
      result.installed++;
      continue;
    }
    const current = await request(`/skills/${existing.id}`);
    if (
      current.instructions === skill.instructions &&
      current.name === skill.name &&
      current.description === skill.description
    ) {
      result.unchanged++;
      continue;
    }
    throw Error(`Existing /${skill.slug} is user-authored or modified; it was preserved.`);
  }
  return result;
}
async function main() {
  const checkout = path.resolve(
    process.argv[2] || path.join(__dirname, '../../runtimes/skills/founder-skill'),
  );
  const skills = buildSkills((file) => readPinned(checkout, file)); // Validate everything before any API write.
  const apiKey = process.env.OSCAR_API_KEY;
  if (!apiKey) throw Error('Set OSCAR_API_KEY privately before installing.');
  const base = new URL(process.env.OSCAR_API_URL || 'http://127.0.0.1:3001/api/v1');
  if (
    !['127.0.0.1', 'localhost'].includes(base.hostname) ||
    base.protocol !== 'http:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !['3001', '3002'].includes(base.port) ||
    base.pathname !== '/api/v1'
  )
    throw Error('Use the local OSCAR API for this installation.');
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(base.toString().replace(/\/$/, '') + route, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error(
        `OSCAR skill API returned HTTP ${response.status}; retrying the installer preserves installed entries.`,
      );
    const value = await response.json();
    return value.data ?? value;
  };
  console.log(
    JSON.stringify({ source: SOURCE, revision: REVISION, ...(await install(skills, request)) }),
  );
}
module.exports = { buildSkills, install, SOURCE, REVISION };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
