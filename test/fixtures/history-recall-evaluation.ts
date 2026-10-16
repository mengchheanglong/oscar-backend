import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DataSource, In } from 'typeorm';
import { User } from '../../src/modules/users/entities/user.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AiMode, Conversation } from '../../src/modules/ai/entities/conversation.entity';
import { ChatMessage, MessageRole } from '../../src/modules/ai/entities/chat-message.entity';
import { MemoryEmbeddingProvider } from '../../src/modules/ai/memory/private-memory.contract';
import { ConversationHistoryRepository } from '../../src/modules/ai/context/conversation-history.repository';
import { HistoryVectorRepository } from '../../src/modules/ai/context/history-vector.repository';
import { HistoryRecallService } from '../../src/modules/ai/context/history-recall.service';
import { DEFAULT_HISTORY_MAX_DISTANCE } from '../../src/modules/ai/context/history-retrieval.contract';

export const historyCases = [
  {
    name: 'exact',
    text: 'Quasar checkpoint is 2040-04-17.',
    query: 'What is the Quasar checkpoint?',
  },
  {
    name: 'paraphrase',
    text: 'My desk should be silent; avoid audible alerts.',
    query: 'Can notifications arrive without making noise?',
  },
  { name: 'multilingual', text: 'Please keep replies concise.', query: 'ขอคำตอบสั้น ๆ' },
  {
    name: 'long_gap',
    text: 'Years ago, the paper archive reference was IVORY.',
    query: 'Where is my old document identifier?',
  },
  {
    name: 'correction',
    text: 'Correction: Harbor shipment now uses carrier SOUTH.',
    query: 'Which carrier for the Harbor shipment?',
  },
  {
    name: 'excluded',
    text: 'Papaya tracking label is NEVERUSE.',
    query: 'What is the Papaya tracking label?',
  },
  {
    name: 'deleted',
    text: 'Lychee tracking label is NEVERUSE.',
    query: 'What is the Lychee tracking label?',
  },
  { name: 'no_answer', text: '', query: 'How should I prepare for a lunar eclipse?' },
];

export const heldOutHistoryCases = [
  {
    name: 'exact',
    text: 'Orion handoff checkpoint is 2041-09-02.',
    query: 'What is the Orion handoff checkpoint?',
  },
  {
    name: 'paraphrase',
    text: 'Only send notifications as text banners; I do not want sound effects.',
    query: 'I would like to see alerts without hearing them.',
  },
  {
    name: 'multilingual',
    text: 'The release label is SILVER.',
    query: 'รหัสรุ่นที่ฉันบอกไว้คืออะไร',
  },
  {
    name: 'long_gap',
    text: 'The old contract is filed under reference FERN.',
    query: 'Remind me of the agreement lookup number.',
  },
  {
    name: 'correction',
    text: 'Correction: the shipment carrier is now WEST.',
    query: 'Which shipping company should we use now?',
  },
  { name: 'excluded', text: 'Marigold private reference is HIDDEN.', query: 'Marigold' },
  { name: 'deleted', text: 'Honeysuckle private reference is HIDDEN.', query: 'Honeysuckle' },
  { name: 'no_answer', text: '', query: 'How should I bake sourdough bread?' },
];

/** An oracle embedding fixture tests pipeline mechanics, not embedding quality. */
export function syntheticHistoryEmbedder(): MemoryEmbeddingProvider {
  return {
    identity: 'synthetic-oracle-1536',
    embed: async (texts) =>
      texts.map((text) => {
        let index = historyCases.findIndex((c) => c.text === text || c.query === text);
        if (text === 'Harbor shipment uses carrier NORTH.') index = 4;
        if (index < 0) index = 20;
        return Array.from({ length: 1536 }, (_, i) => (i === index ? 1 : 0));
      }),
  };
}

export async function evaluateHistoryRecall(
  db: DataSource,
  provider: MemoryEmbeddingProvider,
  kind: 'synthetic_pipeline' | 'live_retrieval',
  maxDistance = DEFAULT_HISTORY_MAX_DISTANCE,
  dataset = historyCases,
) {
  if (
    db.options.type !== 'postgres' ||
    !db.options.url ||
    !new URL(db.options.url).pathname.endsWith('_test')
  )
    throw new Error('DEDICATED_TEST_DATABASE_REQUIRED');
  const userIds: string[] = [],
    projectIds: string[] = [];
  const usage = { calls: 0, texts: 0, inputCharacters: 0, elapsedMs: 0 };
  const observed = new Map<string, number[]>();
  const distance = (a: number[] | undefined, b: number[] | undefined): number | null => {
    if (!a || !b) return null;
    const dot = a.reduce((n, v, i) => n + v * b[i]!, 0);
    return (
      Math.round(
        (1 - dot / Math.sqrt(a.reduce((n, v) => n + v * v, 0) * b.reduce((n, v) => n + v * v, 0))) *
          10000,
      ) / 10000
    );
  };
  const metered: MemoryEmbeddingProvider = {
    identity: provider.identity,
    embed: async (texts) => {
      const chars = texts.reduce((n, t) => n + t.length, 0);
      if (
        usage.calls >= 20 ||
        usage.texts + texts.length > 96 ||
        usage.inputCharacters + chars > 45000
      )
        throw new Error('EVALUATION_PROVIDER_LIMIT');
      usage.calls++;
      usage.texts += texts.length;
      usage.inputCharacters += chars;
      const started = performance.now();
      try {
        const vectors = await provider.embed(texts);
        texts.forEach((text, i) => {
          if (vectors[i]) observed.set(text, vectors[i]!);
        });
        return vectors;
      } finally {
        usage.elapsedMs += performance.now() - started;
      }
    },
  };
  try {
    const users = db.getRepository(User),
      projects = db.getRepository(Project),
      members = db.getRepository(ProjectMember);
    const user = await users.save(
      users.create({
        email: `${randomUUID()}@recall-eval.invalid`,
        displayName: 'Recall evaluation',
        passwordHash: 'synthetic-no-login',
      }),
    );
    userIds.push(user.id);
    const other = await users.save(
      users.create({
        email: `${randomUUID()}@recall-eval.invalid`,
        displayName: 'Foreign evaluation',
        passwordHash: 'synthetic-no-login',
      }),
    );
    userIds.push(other.id);
    const project = await projects.save(
      projects.create({
        key: 'E' + randomUUID().slice(0, 7).toUpperCase(),
        name: 'Recall evaluation',
        createdBy: user.id,
      }),
    );
    projectIds.push(project.id);
    const foreign = await projects.save(
      projects.create({
        key: 'E' + randomUUID().slice(0, 7).toUpperCase(),
        name: 'Foreign evaluation',
        createdBy: other.id,
      }),
    );
    projectIds.push(foreign.id);
    await members.save([
      members.create({ projectId: project.id, userId: user.id, accessRole: ProjectRole.OWNER }),
      members.create({ projectId: project.id, userId: other.id, accessRole: ProjectRole.VIEWER }),
      members.create({ projectId: foreign.id, userId: other.id, accessRole: ProjectRole.OWNER }),
    ]);
    const conversations = db.getRepository(Conversation),
      messages = db.getRepository(ChatMessage);
    const makeChat = async (p = project.id, u = user.id) =>
      conversations.save({ projectId: p, userId: u, title: 'Synthetic recall fixture' });
    const message = async (id: string, content: string) =>
      messages.save({
        conversationId: id,
        role: MessageRole.USER,
        mode: AiMode.WORKSPACE,
        content,
      });
    const current = await makeChat();
    const scope = { projectId: project.id, userId: user.id, conversationId: current.id };
    const sources = new Map<string, { messageId: string; conversationId: string }>();
    for (const c of dataset.filter((c) => c.text)) {
      const chat = await makeChat();
      if (c.name === 'correction') await message(chat.id, 'Harbor shipment uses carrier NORTH.');
      const saved = await message(chat.id, c.text);
      sources.set(c.name, { messageId: saved.id, conversationId: chat.id });
      if (c.name === 'long_gap')
        await messages.update(saved.id, { createdAt: new Date('2020-01-01T00:00:00Z') });
    }
    const forbiddenIds: string[] = [];
    for (const [p, u] of [
      [project.id, other.id],
      [foreign.id, other.id],
    ]) {
      const chat = await makeChat(p, u);
      forbiddenIds.push((await message(chat.id, dataset[1]!.text)).id);
    }
    const history = new ConversationHistoryRepository(db),
      vectors = new HistoryVectorRepository(db);
    const keyword = new HistoryRecallService(history, vectors, null),
      hybrid = new HistoryRecallService(history, vectors, metered, maxDistance);
    for (const indexScope of [
      { projectId: project.id, userId: user.id },
      { projectId: project.id, userId: other.id },
      { projectId: foreign.id, userId: other.id },
    ]) {
      const indexed = await hybrid.indexBatch(indexScope);
      if (indexed.remaining) throw new Error('EVALUATION_FIXTURE_EXCEEDS_BATCH');
    }
    await history.exclude(
      { ...scope, conversationId: sources.get('excluded')!.conversationId },
      sources.get('excluded')!.messageId,
    );
    await history.exclude({ ...scope, conversationId: sources.get('deleted')!.conversationId });
    const cases: {
      name: string;
      expected: string;
      expectedDistance: number | null;
      nearestEligibleDistance: number | null;
      results: {
        mode: string;
        hit: boolean;
        rank: number | null;
        count: number;
        forbiddenSelected: number;
        elapsedMs: number;
      }[];
    }[] = [];
    for (const c of dataset) {
      const expected = ['excluded', 'deleted', 'no_answer'].includes(c.name)
        ? null
        : sources.get(c.name)!.messageId;
      const results = [];
      for (const [mode, service] of [
        ['keyword', keyword],
        ['hybrid', hybrid],
      ] as const) {
        const started = performance.now();
        const selected = await service.select(scope, c.query, '0');
        const ids = selected.map((r) => r.messageId);
        const forbidden = [
          ...forbiddenIds,
          sources.get('excluded')!.messageId,
          sources.get('deleted')!.messageId,
        ];
        results.push({
          mode,
          hit: expected ? ids.includes(expected) : ids.length === 0,
          rank: expected ? ids.indexOf(expected) + 1 : null,
          count: ids.length,
          forbiddenSelected: ids.filter((id) => forbidden.includes(id)).length,
          elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        });
      }
      const distances = dataset
        .filter((item) => item.text && !['excluded', 'deleted'].includes(item.name))
        .map((item) => distance(observed.get(c.query), observed.get(item.text)))
        .filter((n): n is number => n !== null);
      cases.push({
        name: c.name,
        expected: expected ? 'relevant_message' : 'no_results',
        results,
        expectedDistance: expected ? distance(observed.get(c.query), observed.get(c.text)) : null,
        nearestEligibleDistance: distances.length ? Math.min(...distances) : null,
      });
    }
    const summary = ['keyword', 'hybrid'].map((mode) => ({
      mode,
      passed: cases.filter((c) => c.results.find((r) => r.mode === mode)!.hit).length,
      total: cases.length,
      forbiddenSelected: cases.reduce(
        (n, c) => n + c.results.find((r) => r.mode === mode)!.forbiddenSelected,
        0,
      ),
    }));
    return {
      kind,
      maxDistance,
      cases,
      summary,
      usage,
      limits: { maxCalls: 20, maxTexts: 96, maxInputCharacters: 45000 },
      notes:
        kind === 'synthetic_pipeline'
          ? 'Oracle vectors verify mechanics only; no real semantic quality claim.'
          : 'Small synthetic corpus, retrieval-only; no answer correctness, production latency or currency-cost claim.',
    };
  } finally {
    if (projectIds.length) await db.getRepository(Project).delete({ id: In(projectIds) });
    if (userIds.length) await db.getRepository(User).delete({ id: In(userIds) });
  }
}
