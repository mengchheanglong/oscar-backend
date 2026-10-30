// Live, private acceptance evaluation. Rubrics never enter the model prompt.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function validateDataset(dataset) {
  if (dataset.version !== 1 || !Array.isArray(dataset.cases) || !dataset.cases.length)
    throw new Error('INVALID_DATASET');
  const ids = new Set();
  for (const item of dataset.cases) {
    if (
      typeof item.id !== 'string' ||
      !/^[a-z0-9-]{1,80}$/.test(item.id) ||
      ids.has(item.id) ||
      !['development', 'reserved'].includes(item.split) ||
      typeof item.question !== 'string' ||
      !item.question.trim() ||
      item.question.length > 24000 ||
      !Array.isArray(item.criteria) ||
      !item.criteria.length ||
      !item.criteria.every((criterion) => typeof criterion === 'string' && criterion.trim())
    )
      throw new Error('INVALID_CASE');
    ids.add(item.id);
  }
  return dataset;
}

function requestFor(item, project, state) {
  const identity = hash(JSON.stringify({ project, content: item.question, knowledgeScope: 'all' }));
  if (state && state.identity !== identity) throw new Error('RETRY_PAYLOAD_CHANGED');
  return {
    identity,
    conversationId: state?.conversationId,
    clientRequestId: state?.clientRequestId ?? crypto.randomUUID(),
    content: item.question,
    projectKeyOrId: project,
    knowledgeScope: 'all',
  };
}

function inspectResult(result, messages) {
  const answer = result.assistantMessage;
  const snapshot = answer?.evidenceSnapshot;
  const items = snapshot?.items ?? [];
  const blocks = snapshot?.answerReview?.blocks ?? [];
  const saved = messages.find((item) => item.id === answer?.id);
  const retained = blocks.filter((block) => ['SUPPORTED', 'REASONING'].includes(block.verdict));
  const citations = answer?.citations ?? [];
  return {
    completed: answer?.status === 'COMPLETED',
    reviewStatus: snapshot?.answerReview?.status ?? null,
    stageTimings: snapshot?.stageTimings ?? null,
    libraryPassages: items.filter((item) => item.sourceType === 'EXTERNAL_KNOWLEDGE').length,
    libraryCitations: citations.filter((item) => item.sourceType === 'EXTERNAL_KNOWLEDGE').length,
    citationTargetsValid:
      citations.length > 0 &&
      citations.every((citation) =>
        items.some(
          (item) =>
            item.evidenceNumber === citation.evidenceNumber && item.chunkId === citation.chunkId,
        ),
      ),
    hashesValid:
      items.length > 0 &&
      items.every((item) => hash(item.exactExcerpt ?? item.snippet) === item.textSha256),
    anchorsValid:
      retained.length > 0 &&
      retained.every(
        (block) =>
          block.sourceQuotes?.length > 0 &&
          block.sourceQuotes.every((anchor) => {
            const item = items.find((item) => item.evidenceNumber === anchor.evidenceNumber);
            return (item?.exactExcerpt ?? item?.snippet ?? '').includes(anchor.quote);
          }),
      ),
    reloadMatches:
      Boolean(saved) &&
      saved.content === answer.content &&
      isDeepStrictEqual(saved.citations, citations) &&
      isDeepStrictEqual(saved.evidenceSnapshot, snapshot),
    singlePair:
      messages.length === 2 && messages.filter((item) => item.role === 'user').length === 1,
    // Mechanical consistency does not certify relevance, correctness or usefulness.
    humanReview: {
      status: 'PENDING',
      retrievalRelevance: null,
      claimSupport: null,
      factualStatus: null,
      reasoning: null,
      actionability: null,
      criteria: [],
      notes: '',
    },
  };
}

function save(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function parseTool(result) {
  if (result.isError) throw new Error('MCP_OPERATION_FAILED');
  return JSON.parse(result.content.find((block) => block.type === 'text').text);
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  if (!args.includes('--dataset') || !args.includes('--output') || !args.includes('--split'))
    throw new Error('REQUIRE_DATASET_OUTPUT_SPLIT');
  const split = option('--split');
  if (!['development', 'reserved'].includes(split)) throw new Error('INVALID_SPLIT');
  const dataset = validateDataset(JSON.parse(fs.readFileSync(option('--dataset'), 'utf8')));
  const output = path.resolve(option('--output'));
  const repository = path.resolve(__dirname, '..');
  const relative = path.relative(repository, output);
  if (
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative) &&
    !relative.startsWith('var' + path.sep)
  )
    throw new Error('PRIVATE_OUTPUT_REQUIRED');
  if (!process.env.OSCAR_API_KEY || !process.env.OSCAR_PROJECT_ID)
    throw new Error('REQUIRE_HUMAN_PAT_AND_PROJECT');
  fs.mkdirSync(output, { recursive: true });
  const client = new Client({ name: 'business-acceptance-eval', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repository, 'dist/mcp/cli.js')],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      OSCAR_API_URL: process.env.OSCAR_API_URL ?? 'http://127.0.0.1:43101/api/v1',
      OSCAR_API_KEY: process.env.OSCAR_API_KEY,
      OSCAR_PROJECT_ID: process.env.OSCAR_PROJECT_ID,
    },
    stderr: 'pipe',
  });
  await client.connect(transport);
  const results = [];
  try {
    const selected = dataset.cases.filter(
      (item) => item.split === split && (!args.includes('--case') || item.id === option('--case')),
    );
    if (!selected.length) throw new Error('NO_SELECTED_CASES');
    for (const item of selected) {
      const prefix = path.join(output, item.id);
      const stateFile = prefix + '.state.json';
      const state = fs.existsSync(stateFile)
        ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        : null;
      const request = requestFor(item, process.env.OSCAR_PROJECT_ID, state);
      if (fs.existsSync(prefix + '.receipt.json')) {
        if (!state) throw new Error('RECEIPT_WITHOUT_REQUEST_STATE');
        results.push(JSON.parse(fs.readFileSync(prefix + '.receipt.json', 'utf8')).audit);
        continue;
      }
      if (!request.conversationId) {
        const conversation = parseTool(
          await client.callTool({
            name: 'create_assistant_conversation',
            arguments: {
              projectKeyOrId: request.projectKeyOrId,
              title: `Business evaluation: ${item.id}`,
            },
          }),
        );
        request.conversationId = conversation.id;
        save(stateFile, request);
      }
      console.log(JSON.stringify({ case: item.id, status: 'STARTED' }));
      const started = Date.now();
      try {
        const { identity: _identity, ...payload } = request;
        const result = parseTool(
          await client.callTool({ name: 'ask_assistant', arguments: payload }, undefined, {
            timeout: 240000,
          }),
        );
        const messages = parseTool(
          await client.callTool({
            name: 'get_assistant_messages',
            arguments: {
              projectKeyOrId: request.projectKeyOrId,
              conversationId: request.conversationId,
            },
          }),
        );
        const audit = {
          id: item.id,
          seconds: (Date.now() - started) / 1000,
          ...inspectResult(result, messages),
        };
        save(prefix + '.receipt.json', {
          question: item.question,
          criteria: item.criteria,
          result,
          audit,
        });
        fs.writeFileSync(prefix + '.md', result.assistantMessage.content);
        results.push(audit);
        console.log(
          JSON.stringify({
            case: item.id,
            seconds: audit.seconds,
            completed: audit.completed,
            passages: audit.libraryPassages,
            review: audit.reviewStatus,
          }),
        );
      } catch {
        const failure = {
          id: item.id,
          seconds: (Date.now() - started) / 1000,
          error: 'LIVE_CASE_FAILED',
        };
        save(prefix + '.failure.json', failure);
        results.push(failure);
        console.log(JSON.stringify(failure));
        process.exitCode = 1;
      }
    }
  } finally {
    await client.close();
    await transport.close();
  }
  save(path.join(output, `${split}.summary.json`), {
    datasetSha256: hash(JSON.stringify(dataset)),
    split,
    results,
  });
}

module.exports = { validateDataset, requestFor, inspectResult };
if (require.main === module)
  main().catch(() => {
    console.error('BUSINESS_EVALUATION_FAILED; inspect private request state and service health.');
    process.exitCode = 1;
  });
