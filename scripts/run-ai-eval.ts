import 'reflect-metadata';
import {
  AI_EVAL_DATASET,
  EVAL_SOURCE_FIXTURES,
  EvalSourceFixture,
} from '../test/fixtures/ai-eval-dataset';
import { MockLlmProvider } from '../src/modules/ai/llm/mock-llm-provider';
import { ContextAssembler } from '../src/modules/ai/context/context-assembler';
import { RetrievedEvidence } from '../src/modules/ai/retrieval/retrieval.service';
import { Priority } from '../src/modules/requirements/entities/requirement.entity';
import { DecisionStatus } from '../src/modules/decisions/entities/decision.entity';

interface EvalResult {
  caseId: string;
  category: string;
  name: string;
  passed: boolean;
  latencyMs: number;
  retrievalRecall: number;
  citationValid: boolean;
  refusalValid: boolean;
  isolationValid: boolean;
  schemaValid: boolean;
  details: string;
}

const STOP_WORDS = new Set([
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'the',
  'and',
  'for',
  'with',
  'about',
  'from',
  'into',
  'during',
  'including',
  'until',
  'against',
  'among',
  'throughout',
  'despite',
  'towards',
  'upon',
  'concerning',
  'to',
  'in',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'that',
  'this',
  'these',
  'those',
  'there',
  'their',
  'they',
  'you',
  'your',
  'our',
  'we',
  'any',
  'all',
  'some',
  'system',
  'project',
  'team',
  'our',
  'now',
  'can',
  'please',
  'tell',
  'give',
  'provide',
  'high',
  'level',
  'talking',
  'points',
  'achievements',
]);

/**
 * Simulate project-scoped hybrid retrieval over fixtures.
 */
function retrieveEvidence(
  userPrompt: string,
  projectId: string,
  fixtures: EvalSourceFixture[],
  limit = 8,
): RetrievedEvidence[] {
  // 1. Strict project isolation filter
  const scopedFixtures = fixtures.filter((f) => f.projectId === projectId);

  // 2. Compute keyword query tokens
  const tokens = userPrompt
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // 3. Rank fixtures by term matches with whole-word boundaries
  const scored = scopedFixtures.map((f) => {
    const text = `${f.title} ${f.sourceKey} ${f.locator} ${f.content}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      const regex = new RegExp(`\\b${token}\\b`, 'i');
      if (regex.test(text)) {
        score += 1;
      }
    }
    return { fixture: f, score };
  });

  // Sort descending by score, tie-break by revision
  scored.sort((a, b) => b.score - a.score || b.fixture.revision - a.fixture.revision);

  // Filter to items having non-zero score or return empty if none match
  const matched = scored.filter((s) => s.score > 0).slice(0, limit);

  return matched.map((m) => ({
    chunkId: `chk-${m.fixture.sourceId}-1`,
    sourceId: m.fixture.sourceId,
    sourceType: m.fixture.sourceType as RetrievedEvidence['sourceType'],
    title: m.fixture.title,
    locator: m.fixture.locator,
    revision: m.fixture.revision,
    snippet: m.fixture.content,
    score: m.score,
  }));
}

async function runEvaluation() {
  console.log('================================================================');
  console.log('       AI WORKSPACE: MILESTONE P2-05 AI EVALUATION SUITE       ');
  console.log('================================================================\n');

  const llmProvider = new MockLlmProvider();
  const contextAssembler = new ContextAssembler();
  const results: EvalResult[] = [];

  console.log(`Evaluating ${AI_EVAL_DATASET.length} test cases across 6 categories...\n`);

  for (const testCase of AI_EVAL_DATASET) {
    const startTime = Date.now();
    let passed = true;
    let details = 'OK';
    let retrievalRecall = 1.0;
    let citationValid = true;
    let refusalValid = true;
    let isolationValid = true;
    let schemaValid = true;

    try {
      // 1. Project-scoped retrieval
      const retrieved = retrieveEvidence(
        testCase.userPrompt,
        testCase.projectId,
        EVAL_SOURCE_FIXTURES,
        8,
      );

      // Gate 1: Check Cross-Project Isolation
      // Ensure no evidence from forbiddenSourceIds or other projects appears
      if (testCase.forbiddenSourceIds && testCase.forbiddenSourceIds.length > 0) {
        const leaked = retrieved.filter((r) => testCase.forbiddenSourceIds!.includes(r.sourceId));
        if (leaked.length > 0) {
          isolationValid = false;
          passed = false;
          details = `Cross-project leakage detected: ${leaked.map((l) => l.sourceId).join(', ')}`;
        }
      }

      // Gate 2: Retrieval Recall on Answerable Queries
      if (testCase.expectedEvidenceSourceIds && testCase.expectedEvidenceSourceIds.length > 0) {
        const found = testCase.expectedEvidenceSourceIds.filter((expectedId) =>
          retrieved.some((r) => r.sourceId === expectedId),
        );
        retrievalRecall = found.length / testCase.expectedEvidenceSourceIds.length;
        if (retrievalRecall < 0.8) {
          passed = false;
          details = `Retrieval recall below threshold (${(retrievalRecall * 100).toFixed(0)}%)`;
        }
      }

      // Gate 3: Context Assembly
      const assembled = contextAssembler.assemble('Continuum', testCase.mode, retrieved);

      // Handle Structured Action cases vs Chat cases
      if (testCase.category === 'structured_action') {
        const structuredRes = await llmProvider.generateStructuredOutput<Record<string, unknown>>({
          systemPrompt: assembled.systemPrompt,
          userPrompt: testCase.userPrompt,
          temperature: 0.1,
        });

        const data = structuredRes.data;
        if (!data || typeof data !== 'object') {
          schemaValid = false;
          passed = false;
          details = 'Structured output is not a valid JSON object';
        } else if (testCase.expectedStructuredType === 'CREATE_TASKS') {
          if (
            data.type !== 'CREATE_TASKS' ||
            !Array.isArray(data.items) ||
            data.items.length === 0
          ) {
            schemaValid = false;
            passed = false;
            details = 'Invalid CREATE_TASKS schema structure';
          } else {
            const validPriorities = Object.values(Priority);
            const badPriority = (data.items as Array<{ priority?: Priority }>).some(
              (it) => !it.priority || !validPriorities.includes(it.priority),
            );
            if (badPriority) {
              schemaValid = false;
              passed = false;
              details = 'Task item has invalid Priority enum value';
            }
          }
        } else if (testCase.expectedStructuredType === 'MEETING_ANALYSIS') {
          if (
            data.type !== 'MEETING_ANALYSIS' ||
            !data.summary ||
            !Array.isArray(data.decisions) ||
            !Array.isArray(data.requirements) ||
            !Array.isArray(data.actionItems)
          ) {
            schemaValid = false;
            passed = false;
            details = 'Invalid MEETING_ANALYSIS schema structure';
          } else {
            const validDecStatuses = Object.values(DecisionStatus);
            const badDec = (data.decisions as Array<{ status?: DecisionStatus }>).some(
              (d) => !d.status || !validDecStatuses.includes(d.status),
            );
            if (badDec) {
              schemaValid = false;
              passed = false;
              details = 'Meeting decision has invalid DecisionStatus enum value';
            }
          }
        }
      } else {
        // Chat Answer Generation
        const answerRes = await llmProvider.generateAnswer({
          messages: [
            { role: 'system', content: assembled.systemPrompt },
            { role: 'user', content: testCase.userPrompt },
          ],
          evidence: assembled.evidenceItems,
          temperature: 0.2,
        });

        // Gate 4: Refusal on Unanswerable or Injection Queries
        if (testCase.expectRefusal) {
          const isRefusal = answerRes.content.toLowerCase().includes('insufficient evidence');
          if (!isRefusal) {
            refusalValid = false;
            passed = false;
            details = 'Expected refusal on unanswerable query, but model answered';
          }
          if (answerRes.citations.length > 0) {
            citationValid = false;
            passed = false;
            details = 'Refusal response contained hallucinated citations';
          }
        }

        // Gate 5: Citation Resolution Validity
        // Every citation must resolve to an authorized source provided in context
        for (const citation of answerRes.citations) {
          const sourceExists = assembled.evidenceItems.some(
            (e) => e.sourceId === citation.sourceId,
          );
          if (!sourceExists) {
            citationValid = false;
            passed = false;
            details = `Citation references non-existent source: ${citation.sourceId}`;
            break;
          }
        }
      }
    } catch (err: unknown) {
      passed = false;
      details = `Exception: ${err instanceof Error ? err.message : String(err)}`;
    }

    const latencyMs = Date.now() - startTime;
    results.push({
      caseId: testCase.id,
      category: testCase.category,
      name: testCase.name,
      passed,
      latencyMs,
      retrievalRecall,
      citationValid,
      refusalValid,
      isolationValid,
      schemaValid,
      details,
    });
  }

  // ==========================================
  // Report Generation & Summary Statistics
  // ==========================================
  console.log(
    '---------------------------------------------------------------------------------------------',
  );
  console.log(
    '| ID               | Category          | Name                              | Pass | Latency |',
  );
  console.log(
    '---------------------------------------------------------------------------------------------',
  );

  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    const idPad = r.caseId.padEnd(16);
    const catPad = r.category.padEnd(17);
    const namePad = (r.name.length > 33 ? r.name.slice(0, 30) + '...' : r.name).padEnd(33);
    const latPad = `${r.latencyMs}ms`.padStart(7);
    console.log(`| ${idPad} | ${catPad} | ${namePad} | ${status} | ${latPad} |`);
  }
  console.log(
    '---------------------------------------------------------------------------------------------\n',
  );

  // Compute Aggregates
  const totalCases = results.length;
  const passedCases = results.filter((r) => r.passed).length;
  const passRate = (passedCases / totalCases) * 100;

  const answerableCases = results.filter(
    (r) => r.category === 'factual' || r.category === 'multi_source',
  );
  const avgRecall =
    (answerableCases.reduce((sum, r) => sum + r.retrievalRecall, 0) / answerableCases.length) * 100;

  const citationPassed = results.filter((r) => r.citationValid).length;
  const citationRate = (citationPassed / totalCases) * 100;

  const unanswerableCases = results.filter((r) => r.category === 'unanswerable');
  const refusalPassed = unanswerableCases.filter((r) => r.refusalValid).length;
  const refusalRate = (refusalPassed / unanswerableCases.length) * 100;

  const isolationPassed = results.filter((r) => r.isolationValid).length;
  const isolationRate = (isolationPassed / totalCases) * 100;

  const structuredCases = results.filter((r) => r.category === 'structured_action');
  const schemaPassed = structuredCases.filter((r) => r.schemaValid).length;
  const schemaRate = (schemaPassed / structuredCases.length) * 100;

  const avgLatency = Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / totalCases);

  console.log('================================================================');
  console.log('                    EVALUATION METRICS & GATES                  ');
  console.log('================================================================');
  console.log(`Total Evaluation Cases    : ${totalCases}`);
  console.log(`Overall Pass Rate         : ${passedCases}/${totalCases} (${passRate.toFixed(1)}%)`);
  console.log(`Average Latency           : ${avgLatency} ms`);
  console.log('----------------------------------------------------------------');
  console.log(
    `Gate 1: Cross-Project Isolation  : ${isolationRate.toFixed(1)}% (Target: 100%, 0 leaks) -> ${isolationRate === 100 ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `Gate 2: Citation Validity        : ${citationRate.toFixed(1)}% (Target: 100%) -> ${citationRate === 100 ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `Gate 3: Top-8 Retrieval Recall   : ${avgRecall.toFixed(1)}% (Target: >= 90%) -> ${avgRecall >= 90 ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `Gate 4: Unanswerable Refusal     : ${refusalRate.toFixed(1)}% (Target: 100%) -> ${refusalRate === 100 ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `Gate 5: Structured Schema Valid  : ${schemaRate.toFixed(1)}% (Target: 100%) -> ${schemaRate === 100 ? 'PASS' : 'FAIL'}`,
  );
  console.log('================================================================\n');

  if (passedCases === totalCases && avgRecall >= 90) {
    console.log('🎉 ALL AI EVALUATION GATES PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error('❌ SOME AI EVALUATION GATES FAILED. Review failed cases above.\n');
    process.exit(1);
  }
}

runEvaluation().catch((err) => {
  console.error('Fatal evaluation runner error:', err);
  process.exit(1);
});
