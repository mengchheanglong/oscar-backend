const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateDataset, requestFor, inspectResult } = require('./run-business-eval.cjs');

const item = {
  id: 'case-one',
  split: 'development',
  question: 'A hypothetical question?',
  criteria: ['Check the claim'],
};
test('rejects traversal IDs, duplicate cases, invalid splits and absent rubrics', () => {
  for (const cases of [
    [{ ...item, id: '../private' }],
    [{ ...item, id: undefined }],
    [item, item],
    [{ ...item, split: 'all' }],
    [{ ...item, criteria: [] }],
  ])
    assert.throws(() => validateDataset({ version: 1, cases }));
  assert.equal(validateDataset({ version: 1, cases: [item] }).cases.length, 1);
});
test('retries retain identity and never send the evaluation rubric to the model', () => {
  const request = requestFor(item, 'SYNTHETIC');
  const retry = requestFor(item, 'SYNTHETIC', { ...request, conversationId: 'private-chat' });
  assert.equal(retry.clientRequestId, request.clientRequestId);
  assert.equal(retry.content, item.question);
  assert.equal(retry.conversationId, 'private-chat');
  assert.equal('criteria' in retry, false);
  assert.equal('split' in retry, false);
});
test('refuses to reuse a request after the prompt or project changes', () => {
  const state = requestFor(item, 'SYNTHETIC');
  assert.throws(
    () => requestFor({ ...item, question: 'Changed?' }, 'SYNTHETIC', state),
    /RETRY_PAYLOAD_CHANGED/,
  );
  assert.throws(() => requestFor(item, 'OTHER', state), /RETRY_PAYLOAD_CHANGED/);
});
test('empty or withheld evidence cannot pass anchor and citation checks vacuously', () => {
  const audit = inspectResult(
    {
      assistantMessage: {
        id: 'a',
        status: 'COMPLETED',
        content: 'Withheld',
        citations: [],
        evidenceSnapshot: { items: [] },
      },
    },
    [],
  );
  assert.equal(audit.anchorsValid, false);
  assert.equal(audit.hashesValid, false);
  assert.equal(audit.citationTargetsValid, false);
  assert.equal(audit.reloadMatches, false);
  assert.equal(audit.humanReview.status, 'PENDING');
  assert.equal(audit.calculationInputsValid, false);
  assert.equal(audit.calculationPrinciplesValid, false);
});

test('calculation provenance checks are independent of model-review anchors', () => {
  const question = 'Calculate price $20.';
  const quote = 'Contribution is price minus variable cost.';
  const receipt = {
    questionSha256: createHash('sha256').update(question).digest('hex'),
    inputs: { price: { start: 17, end: 19, quote: '20' } },
    principles: [{ evidenceNumber: 1, quote }],
  };
  const answer = {
    evidenceSnapshot: {
      items: [{ evidenceNumber: 1, sourceType: 'EXTERNAL_KNOWLEDGE', exactExcerpt: quote }],
      calculationAudit: { status: 'CALCULATED', receipts: [receipt] },
    },
  };
  const good = inspectResult({ userMessage: { content: question }, assistantMessage: answer }, []);
  assert.equal(good.calculationInputsValid, true);
  assert.equal(good.calculationPrinciplesValid, true);
  assert.equal(good.anchorsValid, false);
  receipt.inputs.price.start = 16;
  receipt.principles[0].quote = 'Fabricated';
  const bad = inspectResult({ userMessage: { content: question }, assistantMessage: answer }, []);
  assert.equal(bad.calculationInputsValid, false);
  assert.equal(bad.calculationPrinciplesValid, false);
});
test('detects forged citations, stale snapshots and invalid source quotes independently', () => {
  const text = 'Synthetic explanatory passage.';
  const source = {
    evidenceNumber: 1,
    chunkId: 'c',
    sourceType: 'EXTERNAL_KNOWLEDGE',
    exactExcerpt: text,
    textSha256: createHash('sha256').update(text).digest('hex'),
  };
  const answer = {
    id: 'a',
    role: 'assistant',
    status: 'COMPLETED',
    content: 'Claim',
    citations: [{ evidenceNumber: 1, chunkId: 'c', sourceType: 'EXTERNAL_KNOWLEDGE' }],
    evidenceSnapshot: {
      items: [source],
      answerReview: {
        status: 'APPROVED',
        blocks: [{ verdict: 'SUPPORTED', sourceQuotes: [{ evidenceNumber: 1, quote: text }] }],
      },
    },
  };
  const messages = [{ role: 'user' }, structuredClone(answer)];
  const good = inspectResult({ assistantMessage: answer }, messages);
  for (const key of [
    'hashesValid',
    'anchorsValid',
    'citationTargetsValid',
    'reloadMatches',
    'singlePair',
  ])
    assert.equal(good[key], true, key);
  answer.citations[0].chunkId = 'forged';
  answer.evidenceSnapshot.answerReview.blocks[0].sourceQuotes[0].quote = 'not in source';
  source.textSha256 = 'invalid';
  const bad = inspectResult({ assistantMessage: answer }, messages);
  for (const key of ['hashesValid', 'anchorsValid', 'citationTargetsValid', 'reloadMatches'])
    assert.equal(bad[key], false, key);
});
