import 'reflect-metadata';
import 'dotenv/config';
import AppDataSource from '../src/database/data-source';
import { Project } from '../src/modules/projects/entities/project.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { KnowledgeSource } from '../src/modules/ingestion/entities/knowledge-source.entity';
import { KnowledgeSourceType } from '../src/modules/ingestion/entities/knowledge-source.entity';
import { RetrievalService } from '../src/modules/mavis/retrieval/retrieval.service';
import { ContextAssembler } from '../src/modules/assistant/context/context-assembler';
import { AssistantMode } from '../src/modules/assistant/entities/conversation.entity';
import { MockEmbeddingProvider } from '../src/modules/ingestion/embedding';
import { DeepSeekLlmProvider } from '../src/modules/assistant/llm/deepseek-llm-provider';
import { MockLlmProvider } from '../src/modules/assistant/llm/mock-llm-provider';

async function run() {
  console.log('================================================================');
  console.log('       AI COPILOT: MODES, SOURCES & GITHUB VERIFICATION         ');
  console.log('================================================================\n');

  await AppDataSource.initialize();

  const projectRepo = AppDataSource.getRepository(Project);
  const userRepo = AppDataSource.getRepository(User);
  const sourceRepo = AppDataSource.getRepository(KnowledgeSource);

  const project = await projectRepo.findOne({ where: { key: 'AIW' } });
  if (!project) throw new Error('Project AIW not found');

  const user = await userRepo.findOne({ where: {} });
  if (!user) throw new Error('User not found');

  console.log(`[Target Project] ${project.name} (${project.key}) [ID: ${project.id}]`);
  console.log(`[Target User]    ${user.email} [ID: ${user.id}]\n`);

  // 1. Inspect Knowledge Sources in Project AIW
  const sources = await sourceRepo.find({ where: { projectId: project.id } });
  console.log(`[Step 1] Knowledge Base Inventory: Found ${sources.length} sources`);
  const typeCounts: Record<string, number> = {};
  for (const s of sources) {
    typeCounts[s.sourceType] = (typeCounts[s.sourceType] || 0) + 1;
  }
  for (const [st, cnt] of Object.entries(typeCounts)) {
    console.log(`  - ${st.padEnd(16)}: ${cnt} item(s)`);
  }

  const nonCodeSources = await sourceRepo.find({
    where: { projectId: project.id },
  });
  console.log('\n--- Non-Code Sources in DB ---');
  for (const s of nonCodeSources) {
    if (s.sourceType !== KnowledgeSourceType.GITHUB_CODE) {
      console.log(`  [${s.sourceType}] "${s.title}"`);
    }
  }

  // 2. Setup Retrieval & LLM
  const mockEmbeddingProvider = new MockEmbeddingProvider(1536, 'mock-embedding-3-small');
  const retrievalService = new RetrievalService(AppDataSource);
  retrievalService.setEmbeddingProvider(mockEmbeddingProvider);

  const contextAssembler = new ContextAssembler();

  // Check LLM Provider
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.AI_CHAT_MODEL || 'deepseek-flash';

  let llmProvider: any;
  if (process.env.AI_ENABLED === 'true' && apiKey && !apiKey.startsWith('mock')) {
    try {
      console.log(`\n[Step 2] Using DeepSeek LLM Provider (${model} at ${baseUrl})`);
      llmProvider = new DeepSeekLlmProvider(apiKey, baseUrl, model);
    } catch {
      console.log(`\n[Step 2] Falling back to MockLlmProvider`);
      llmProvider = new MockLlmProvider();
    }
  } else {
    console.log(`\n[Step 2] Using MockLlmProvider`);
    llmProvider = new MockLlmProvider();
  }

  // 3. Test All 6 Operational Modes
  console.log('\n================================================================');
  console.log('  TESTING ALL 6 COPILOT MODES (Distinct Perspectives)');
  console.log('================================================================');

  const testQuery = 'proposals';

  // Retrieve initial evidence
  const multiEvidence = await retrievalService.retrieve({
    actorId: user.id,
    projectId: project.id,
    query: testQuery,
    limit: 6,
    mode: 'hybrid',
  });
  console.log(`Retrieved ${multiEvidence.length} evidence items for prompt: "${testQuery}"\n`);
  for (const ev of multiEvidence) {
    console.log(`  - [${ev.sourceType}] ${ev.title} (Locator: ${ev.locator})`);
  }

  const modes: { mode: AssistantMode; label: string; expectedFocus: string }[] = [
    {
      mode: AssistantMode.PM,
      label: 'Project Planning (PM)',
      expectedFocus: 'progress, milestones, risks, blockers',
    },
    {
      mode: AssistantMode.DEVELOPER,
      label: 'Development (DEV)',
      expectedFocus: 'technical architecture, APIs, code guidance',
    },
    {
      mode: AssistantMode.QA,
      label: 'Quality Assurance (QA)',
      expectedFocus: 'acceptance criteria, test cases, verification',
    },
    {
      mode: AssistantMode.DX,
      label: 'Developer Experience (DX)',
      expectedFocus: 'workflow, onboarding, developer setup',
    },
    {
      mode: AssistantMode.INFRASTRUCTURE,
      label: 'Infrastructure (INFRA)',
      expectedFocus: 'deployment, containers, runtime ops, reliability',
    },
    {
      mode: AssistantMode.PRESENTATION,
      label: 'Reports & Summaries (PRES)',
      expectedFocus: 'executive summary, talking points, presentation',
    },
  ];

  const modeAnswers: Record<string, string> = {};

  for (const item of modes) {
    console.log(`\n--- Testing Mode: [${item.label}] ---`);
    console.log(`Expected Focus: ${item.expectedFocus}`);

    const assembled = contextAssembler.assemble(project.name, item.mode, multiEvidence);

    // Verify system prompt contains the specific mode instruction
    const hasModeDirective = assembled.systemPrompt.includes(
      item.mode === AssistantMode.PM
        ? 'PM (Project Manager) mode'
        : item.mode === AssistantMode.DEVELOPER
          ? 'Developer mode'
          : item.mode === AssistantMode.QA
            ? 'QA (Quality Assurance) mode'
            : item.mode === AssistantMode.DX
              ? 'DX (Developer Experience) mode'
              : item.mode === AssistantMode.INFRASTRUCTURE
                ? 'Infrastructure mode'
                : 'Presentation mode',
    );
    console.log(`  ✓ System Prompt tailored to mode: ${hasModeDirective ? 'YES' : 'NO'}`);

    try {
      const result = await llmProvider.generateAnswer({
        messages: [
          { role: 'system', content: assembled.systemPrompt },
          {
            role: 'user',
            content: 'Explain how decision task proposals should be reviewed and implemented.',
          },
        ],
        evidence: assembled.evidenceItems,
      });

      modeAnswers[item.mode] = result.content;
      console.log(`  ✓ Answer generated (${result.content.length} chars)`);
      console.log(`  Citations count: ${(result.citations || []).length}`);
      console.log(
        `  Preview (first 250 chars):\n    "${result.content.slice(0, 250).replace(/\n/g, ' ')}..."\n`,
      );
    } catch (err: any) {
      console.log(`  [LLM Error]: ${err.message}. Verifying mock fallback response.`);
      const mockFallback = new MockLlmProvider();
      const result = await mockFallback.generateAnswer({
        messages: [
          { role: 'system', content: assembled.systemPrompt },
          {
            role: 'user',
            content: 'Explain how decision task proposals should be reviewed and implemented.',
          },
        ],
        evidence: assembled.evidenceItems,
      });
      modeAnswers[item.mode] = result.content;
      console.log(`  ✓ Fallback answer generated (${result.content.length} chars)`);
    }
  }

  // Verify answer diversity across modes
  const uniqueAnswers = new Set(Object.values(modeAnswers));
  console.log(
    `\n✓ Mode Diversity: ${uniqueAnswers.size} distinct answers across ${modes.length} modes.`,
  );

  // 4. Test Source Filtering
  console.log('\n================================================================');
  console.log('  TESTING SOURCE FILTERING (Dedicated Knowledge Retrieval)');
  console.log('================================================================');

  const sourceFilters: { label: string; filter?: KnowledgeSourceType; query: string }[] = [
    { label: 'All Sources (Unfiltered)', filter: undefined, query: 'proposals' },
    { label: 'Documents Only', filter: KnowledgeSourceType.DOCUMENT, query: 'SRS' },
    { label: 'Decisions Only', filter: KnowledgeSourceType.DECISION, query: 'proposals' },
    { label: 'Tasks Only', filter: KnowledgeSourceType.TASK, query: 'proposals' },
    { label: 'GitHub PRs Only', filter: KnowledgeSourceType.GITHUB_PR, query: 'Milestone' },
    { label: 'GitHub Codebase Only', filter: KnowledgeSourceType.GITHUB_CODE, query: 'controller' },
  ];

  for (const sf of sourceFilters) {
    const res = await retrievalService.retrieve({
      actorId: user.id,
      projectId: project.id,
      query: sf.query,
      filters: sf.filter ? { sourceType: sf.filter } : undefined,
      limit: 5,
      mode: 'hybrid',
    });

    const matchesFilter = sf.filter ? res.every((e) => e.sourceType === sf.filter) : true;

    console.log(`Filter [${sf.label}] (Query: "${sf.query}"):`);
    console.log(
      `  Retrieved: ${res.length} items | Strictly matching filter: ${matchesFilter ? '✓ PASS' : '✗ FAIL'}`,
    );
    if (res.length > 0) {
      console.log(
        `  Sample: "[${res[0]!.sourceType}] ${res[0]!.title}" (Locator: ${res[0]!.locator})`,
      );
    }
  }

  // 5. Test GitHub Specific Retrieval & Grounding
  console.log('\n================================================================');
  console.log('  TESTING GITHUB INTEGRATION RETRIEVAL & AI CITATION');
  console.log('================================================================');

  const githubQuery = 'health controller';
  const githubEvidence = await retrievalService.retrieve({
    actorId: user.id,
    projectId: project.id,
    query: githubQuery,
    limit: 6,
    mode: 'hybrid',
  });

  console.log(`Query: "${githubQuery}"`);
  console.log(`Total retrieved items: ${githubEvidence.length}`);
  const ghItems = githubEvidence.filter(
    (e) =>
      e.sourceType === KnowledgeSourceType.GITHUB_PR ||
      e.sourceType === KnowledgeSourceType.GITHUB_CODE ||
      e.sourceType === KnowledgeSourceType.GITHUB_ISSUE ||
      e.title.toLowerCase().includes('github') ||
      e.title.toLowerCase().includes('health'),
  );
  console.log(`GitHub codebase evidence items: ${ghItems.length}`);
  for (const gh of ghItems) {
    console.log(`  - [${gh.sourceType}] ${gh.title} (${gh.locator})`);
  }

  const ghAssembled = contextAssembler.assemble(
    project.name,
    AssistantMode.DEVELOPER,
    githubEvidence,
  );
  console.log(`\nAssembled Developer Context for GitHub query:`);
  console.log(`Evidence character count: ${ghAssembled.evidenceText.length} chars`);
  console.log(
    `Prompt contains UNTRUSTED DATA boundary: ${ghAssembled.systemPrompt.includes('UNTRUSTED DATA BOUNDARY')}`,
  );

  await AppDataSource.destroy();
  console.log('\n================================================================');
  console.log('  ✓ ALL AI COPILOT MODES, SOURCES & GITHUB TESTS COMPLETED!');
  console.log('================================================================');
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
