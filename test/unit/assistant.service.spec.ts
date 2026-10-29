import { SkillsService } from '../../src/modules/skills/skills.service';
import { ConversationContextService } from '../../src/modules/assistant/context/conversation-context.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AssistantService } from '../../src/modules/assistant/assistant.service';
import { ContextAssembler } from '../../src/modules/assistant/context/context-assembler';
import { AssistantMode } from '../../src/modules/assistant/entities/assistant-mode.enum';
import {
  ChatMessage,
  MessageStatus,
} from '../../src/modules/assistant/entities/chat-message.entity';
import { Conversation } from '../../src/modules/assistant/entities/conversation.entity';
import { LlmProvider } from '../../src/modules/assistant/llm/llm-provider.interface';
import {
  RetrievalService,
  RetrievedEvidence,
} from '../../src/modules/mavis/retrieval/retrieval.service';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities';
import { ProjectMember } from '../../src/modules/projects/entities/project-member.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import { PrivateMemoryService } from '../../src/modules/assistant/memory/private-memory.service';
import { SavedMemoryKind } from '../../src/modules/assistant/entities/saved-memory.entity';
import { SystemRole, User } from '../../src/modules/users/entities/user.entity';

describe('AssistantService', () => {
  let service: AssistantService;
  const skills = { prepare: jest.fn() };
  let mockConversationRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let mockMessageRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let mockProjectRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let mockProjectMemberRepo: {
    find: jest.Mock;
  };
  let mockUserRepo: {
    findOne: jest.Mock;
  };
  let mockRetrievalService: {
    retrieve: jest.Mock;
    setEmbeddingProvider: jest.Mock;
  };
  let contextAssembler: ContextAssembler;
  let mockLlmProvider: {
    generateAnswer: jest.Mock;
    generateStructuredOutput: jest.Mock;
  };
  let mockIngestionService: {
    getEmbeddingProvider: jest.Mock;
  };
  let mockMemoryService: { select: jest.Mock };

  const mockProjectId = 'proj-1111-1111';
  const mockUserId = 'user-2222-2222';

  beforeEach(() => {
    skills.prepare.mockReset().mockResolvedValue([]);
    mockConversationRepo = {
      create: jest.fn((dto) => ({
        id: 'conv-1',
        ...dto,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entity) => Promise.resolve({ id: entity.id || 'conv-1', ...entity })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    mockMessageRepo = {
      create: jest.fn((dto) => ({ id: 'msg-1', ...dto, createdAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve({ id: entity.id || 'msg-1', ...entity })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    mockProjectRepo = {
      findOne: jest.fn().mockResolvedValue({ id: mockProjectId, name: 'Test Project' }),
      find: jest.fn().mockResolvedValue([{ id: mockProjectId }]),
    };

    mockProjectMemberRepo = {
      find: jest.fn().mockResolvedValue([{ projectId: mockProjectId }]),
    };

    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({ id: mockUserId, systemRole: SystemRole.USER }),
    };

    mockRetrievalService = {
      retrieve: jest.fn().mockResolvedValue([]),
      setEmbeddingProvider: jest.fn(),
    };

    contextAssembler = new ContextAssembler();

    mockLlmProvider = {
      generateAnswer: jest.fn(),
      generateStructuredOutput: jest.fn(),
    };

    mockIngestionService = {
      getEmbeddingProvider: jest.fn().mockReturnValue(null),
    };
    mockMemoryService = { select: jest.fn().mockResolvedValue([]) };

    service = new AssistantService(
      mockConversationRepo as unknown as Repository<Conversation>,
      mockMessageRepo as unknown as Repository<ChatMessage>,
      mockProjectRepo as unknown as Repository<Project>,
      mockProjectMemberRepo as unknown as Repository<ProjectMember>,
      mockUserRepo as unknown as Repository<User>,
      mockRetrievalService as unknown as RetrievalService,
      contextAssembler,
      mockLlmProvider as unknown as LlmProvider,
      mockIngestionService as unknown as IngestionService,
      mockMemoryService as unknown as PrivateMemoryService,
      {
        withTurn: async (_scope: unknown, action: () => Promise<unknown>) => action(),
        prepare: async (_scope: unknown, currentId: string, system: string) => ({
          messages: [
            { role: 'system', content: system },
            ...(await mockMessageRepo.find())
              .reverse()
              .filter((m: { id: string }) => m.id !== currentId)
              .map((m: { role: string; content: string }) => ({
                role: m.role,
                content: m.content,
              })),
            { role: 'user', content: mockMessageRepo.save.mock.calls[0]?.[0]?.content },
          ],
        }),
        commit: async (_scope: unknown, _prepared: unknown, answer: ChatMessage) => {
          await mockMessageRepo.save(answer);
        },
      } as unknown as ConversationContextService,
      undefined,
      undefined,
      undefined,
      skills as unknown as SkillsService,
    );
  });

  describe('createConversation', () => {
    it('creates a new conversation successfully', async () => {
      const result = await service.createConversation(mockProjectId, mockUserId, {
        title: 'Q&A on sprint',
        defaultMode: AssistantMode.DEVELOPER,
      });

      expect(mockProjectRepo.findOne).toHaveBeenCalledWith({ where: { id: mockProjectId } });
      expect(mockConversationRepo.create).toHaveBeenCalledWith({
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'Q&A on sprint',
        defaultMode: AssistantMode.DEVELOPER,
        includeAllWorkspaces: false,
      });
      expect(result.id).toBe('conv-1');
    });

    it('persists all-project scope when creating a standalone chat', async () => {
      const result = await service.createConversation(mockProjectId, mockUserId, {
        includeAllWorkspaces: true,
      });
      expect(result.includeAllWorkspaces).toBe(true);
    });

    it('throws NotFoundException when project does not exist', async () => {
      mockProjectRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createConversation('unknown-proj', mockUserId, { title: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getConversation', () => {
    it('returns conversation if found and authorized', async () => {
      mockConversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'Architecture discussion',
      });

      const conv = await service.getConversation(mockProjectId, mockUserId, 'conv-1');
      expect(conv.title).toBe('Architecture discussion');
    });

    it('throws NotFoundException if not found or different user/project', async () => {
      mockConversationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getConversation(mockProjectId, mockUserId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('postMessage', () => {
    describe('durable request recovery', () => {
      it('uses the saved skill snapshot on retry and retains skills on later turns', async () => {
        const selected = [
          {
            id: 'qa-skill',
            slug: 'qa',
            name: 'QA',
            version: 1,
            instructions: 'Check the outcome before claiming success.',
          },
        ];
        skills.prepare.mockResolvedValue(selected);
        mockLlmProvider.generateAnswer.mockRejectedValueOnce(new Error('Synthetic outage'));
        const dto = {
          content: '/qa Build a plan',
          clientRequestId: 'fab6420e-dee7-4ae6-84d6-82db7819af65',
        };
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', dto);
        skills.prepare.mockResolvedValue([]);
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', dto);
        expect(skills.prepare).toHaveBeenCalledTimes(1);
        expect(
          JSON.stringify(mockLlmProvider.generateAnswer.mock.calls[1]?.[0].messages),
        ).toContain(selected[0]!.instructions);
        expect(saved.find((m) => m.role === 'user')?.skillContext).toEqual(selected);
        skills.prepare.mockResolvedValue(selected);
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
          content: 'Continue',
          clientRequestId: '065bc3de-54c3-4ca9-b21c-cb08a678c7b6',
        });
        expect(
          JSON.stringify(mockLlmProvider.generateAnswer.mock.calls[2]?.[0].messages),
        ).toContain(selected[0]!.instructions);
      });
      const requestId = 'a329389a-cc68-40f6-8a85-51101f78ed46';
      const request = {
        content: 'Synthetic reliability question',
        mode: AssistantMode.WORKSPACE,
        clientRequestId: requestId,
      };
      let saved: ChatMessage[];
      beforeEach(() => {
        saved = [];
        mockConversationRepo.findOne.mockResolvedValue({
          id: 'conv-1',
          projectId: mockProjectId,
          userId: mockUserId,
          title: 'QA',
          defaultMode: AssistantMode.WORKSPACE,
        });
        mockMessageRepo.create.mockImplementation((dto) => ({
          id: dto.id || `message-${saved.length}`,
          createdAt: new Date(),
          ...dto,
        }));
        mockMessageRepo.save.mockImplementation(async (message) => {
          saved = [...saved.filter((item) => item.id !== message.id), { ...message }];
          return message;
        });
        mockMessageRepo.find.mockImplementation(async (options) =>
          options?.where?.clientRequestId
            ? saved.filter((message) => message.clientRequestId === options.where.clientRequestId)
            : [],
        );
        mockMessageRepo.findOne.mockImplementation(async () =>
          [...saved].reverse().find((message) => message.role === 'user'),
        );
        mockLlmProvider.generateAnswer.mockResolvedValue({
          content: 'Synthetic answer',
          citations: [],
          modelName: 'test',
          promptTokens: 1,
          completionTokens: 1,
        });
      });
      it('grounds a strategic review in the selected goal and reviewed memory before calling the model', async () => {
        const goal = {
          id: 'goal-review',
          projectId: mockProjectId,
          title: 'Reach validated demand',
          status: 'ACTIVE',
          target: '100 users',
          progress: 0,
          metrics: [
            { name: 'Validated users', baselineValue: 0, currentValue: 35, targetValue: 100 },
          ],
          milestones: [],
        };
        const goals = {
          getGoalSummary: jest.fn().mockResolvedValue({
            goal,
            breakdown: { measuredProgress: 35, tasksProgress: 100 },
            linkedTasks: [{ title: 'Interview users' }],
            linkedDecisions: [{ title: 'Validate before scaling' }],
          }),
          getActiveGoalsForScope: jest.fn().mockResolvedValue([goal]),
        };
        const mavis = {
          retrieveContext: jest.fn().mockResolvedValue({
            approvedMemories: [
              {
                id: 'memory-reviewed',
                statement: 'Interviews establish demand before scaling',
                type: 'FACT',
                scopeType: 'PROJECT',
                provenance: { sourcePlatform: 'oscar', sourceType: 'MANUAL' },
              },
            ],
          }),
        };
        Object.assign(service, { goalsService: goals, mavisService: mavis });
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
          content: 'Should we polish a logo instead of interviewing users?',
          mode: AssistantMode.STRATEGY,
          goalId: goal.id,
        });
        expect(goals.getGoalSummary).toHaveBeenCalledWith(goal.id, mockUserId);
        const prompt = mockLlmProvider.generateAnswer.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('Measured progress: 35%');
        expect(prompt).toContain('Interviews establish demand before scaling');
        expect(prompt).toContain('Validate before scaling');
        expect(prompt).toContain('not* doing low-value');
      });

      it('rejects an inaccessible selected goal before persisting a chat turn', async () => {
        Object.assign(service, {
          goalsService: {
            getGoalSummary: jest.fn().mockRejectedValue(new NotFoundException('Goal not found')),
          },
        });
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', {
            ...request,
            goalId: 'foreign-goal',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(mockMessageRepo.save).not.toHaveBeenCalled();
        expect(mockLlmProvider.generateAnswer).not.toHaveBeenCalled();
      });

      it('persists canonical external citations and rejects forged chunk IDs', async () => {
        const external = {
          chunkId: 'external-chunk',
          sourceId: 'external-doc',
          documentId: 'external-doc',
          sourceType: 'EXTERNAL_KNOWLEDGE',
          title: 'Synthetic course',
          revision: 1,
          locator: 'Page 2',
          text: 'Subscription pricing',
          snippet: 'Subscription pricing',
          score: 0.01,
          sourceUrl: 'https://example.org/lecture.pdf',
          courseCode: 'DEMO',
          institution: 'Synthetic',
          pageStart: 2,
          collectionId: 'mba-business',
        };
        const knowledge = {
          retrieve: jest.fn().mockResolvedValue({ evidence: [external], unavailable: false }),
        };
        Object.assign(service, { knowledge });
        mockLlmProvider.generateAnswer.mockResolvedValue({
          content: 'Pricing [Evidence #1]',
          citations: [{ ...external, sourceUrl: 'https://evil.example/' }, { chunkId: 'forged' }],
          modelName: 'test',
        });
        const answer = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
          ...request,
          includeKnowledge: true,
        });
        expect(knowledge.retrieve).toHaveBeenCalledWith(request.content, mockUserId, 'all');
        expect(answer.assistantMessage.citations).toEqual([
          expect.objectContaining({
            sourceType: 'EXTERNAL_KNOWLEDGE',
            sourceUrl: external.sourceUrl,
            pageStart: 2,
            courseCode: 'DEMO',
            evidenceNumber: 1,
          }),
        ]);
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', request),
        ).rejects.toThrow();
      });

      it('reports supplementary outage while retaining normal workspace generation', async () => {
        const knowledge = {
          retrieve: jest.fn().mockResolvedValue({ evidence: [], unavailable: true }),
        };
        Object.assign(service, { knowledge });
        const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
          content: 'pricing',
          includeKnowledge: true,
        });
        expect(result.assistantMessage.content).toContain(
          'Supplementary knowledge sources were unavailable',
        );
        expect(mockRetrievalService.retrieve).toHaveBeenCalled();
        expect(mockLlmProvider.generateAnswer).toHaveBeenCalled();
      });

      it('does not consult knowledge without explicit request opt-in', async () => {
        const knowledge = { retrieve: jest.fn() };
        Object.assign(service, { knowledge });
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        expect(knowledge.retrieve).not.toHaveBeenCalled();
      });

      describe('required source policy', () => {
        const source = {
          chunkId: 'grounded-chunk',
          sourceId: 'grounded-book',
          sourceType: 'EXTERNAL_KNOWLEDGE',
          title: 'Synthetic contribution margin teaching',
          revision: 1,
          locator: 'Page 4',
          text: 'Contribution margin is revenue minus variable cost. It contributes to fixed costs and profit.',
          snippet: 'Contribution margin is revenue minus variable cost.',
          score: 0.1,
        };
        function requireSources(evidence = [source], unavailable = false) {
          // Service wiring fixture only; semantic verdict/quote validation is
          // independently exercised in answer-support.spec.ts.
          mockLlmProvider.generateStructuredOutput.mockImplementation(async ({ userPrompt }) => {
            const input = JSON.parse(userPrompt);
            return {
              data: {
                blocks: input.blocks.map((b: { id: number }) => ({
                  id: b.id,
                  verdict: 'SUPPORTED',
                  standalone: true,
                  claimType: 'SOURCE_FACT',
                  checks: {
                    entailment: true,
                    scope: true,
                    numbers: true,
                    causality: true,
                    evidenceStatus: true,
                  },
                  sources: [{ evidenceNumber: 1, segmentId: 0 }],
                })),
              },
              modelName: 'test-review',
              promptTokens: 10,
              completionTokens: 5,
            };
          });
          const knowledge = {
            policy: () => ({ enabled: true, required: true }),
            retrieve: jest.fn().mockResolvedValue({ evidence, unavailable }),
          };
          Object.assign(service, { knowledge });
          return knowledge;
        }
        it('persists the support audit, removes rejected citations and does not review again on replay', async () => {
          const other = {
            ...source,
            chunkId: 'unrelated',
            sourceId: 'second-book',
            text: 'A different proposed plan.',
          };
          requireSources([source, other]);
          mockLlmProvider.generateAnswer.mockResolvedValue({
            content:
              'Margin funds fixed costs. [Evidence #1]\n\nThe proposed pilot has already succeeded. [Evidence #2]',
            citations: [source, other],
            modelName: 'test',
            promptTokens: 20,
            completionTokens: 10,
          });
          mockLlmProvider.generateStructuredOutput.mockResolvedValueOnce({
            data: {
              blocks: [
                {
                  id: 0,
                  verdict: 'SUPPORTED',
                  standalone: true,
                  claimType: 'SOURCE_FACT',
                  checks: {
                    entailment: true,
                    scope: true,
                    numbers: true,
                    causality: true,
                    evidenceStatus: true,
                  },
                  sources: [{ evidenceNumber: 1, quote: source.text }],
                },
                {
                  id: 1,
                  verdict: 'UNSUPPORTED',
                  standalone: true,
                  claimType: 'SOURCE_FACT',
                  checks: {
                    entailment: false,
                    scope: false,
                    numbers: false,
                    causality: false,
                    evidenceStatus: false,
                  },
                  sources: [],
                },
              ],
            },
            modelName: 'test-review',
            promptTokens: 10,
            completionTokens: 5,
          });
          const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
          expect(result.assistantMessage.content).not.toContain('already succeeded');
          expect(result.assistantMessage.citations).toHaveLength(1);
          expect(result.assistantMessage.evidenceSnapshot?.items).toHaveLength(2);
          expect(result.assistantMessage.evidenceSnapshot?.answerReview?.status).toBe('FILTERED');
          expect(result.assistantMessage.promptTokens).toBe(30);
          expect(await service.postMessage(mockProjectId, mockUserId, 'conv-1', request)).toEqual(
            result,
          );
          expect(mockLlmProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);
        });
        it('withholds a cited draft when source review fails without logging its private exception', async () => {
          requireSources();
          mockLlmProvider.generateAnswer.mockResolvedValue({
            content: 'A draft. [Evidence #1]',
            citations: [source],
            modelName: 'test',
            promptTokens: 20,
            completionTokens: 10,
          });
          mockLlmProvider.generateStructuredOutput.mockRejectedValueOnce(
            new Error('PRIVATE source body'),
          );
          const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
          expect(result.assistantMessage.content).toContain('source-support check');
          expect(result.assistantMessage.content).not.toContain('PRIVATE');
          expect(result.assistantMessage.citations).toEqual([]);
          expect(result.assistantMessage.evidenceSnapshot?.answerReview?.status).toBe(
            'UNAVAILABLE',
          );
        });
        it.each([undefined, false])(
          'retrieves and grounds answers even when client opt-in is %s',
          async (includeKnowledge) => {
            const knowledge = requireSources();
            mockLlmProvider.generateAnswer.mockResolvedValue({
              content: 'First calculate contribution margin [Evidence #1].',
              citations: [source],
              modelName: 'test',
            });
            const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
              ...request,
              includeKnowledge,
            });
            expect(knowledge.retrieve).toHaveBeenCalledWith(
              request.content,
              mockUserId,
              'all',
              true,
            );
            expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
              expect.objectContaining({
                actorId: mockUserId,
                projectId: mockProjectId,
                allowWorkspaceFallback: false,
              }),
            );
            expect(result.assistantMessage.citations).toEqual([
              expect.objectContaining({ chunkId: source.chunkId, evidenceNumber: 1 }),
            ]);
            const prompt = mockLlmProvider.generateAnswer.mock.calls[0][0].messages[0].content;
            expect(prompt).toContain('SOURCE-REQUIRED MODE');
            expect(prompt).not.toContain(
              'Use general knowledge and reasoning for explanations, brainstorming and plans even when no source matches',
            );
          },
        );
        it.each([false, true])(
          'does not generate an unsourced answer when retrieval is empty (outage=%s)',
          async (unavailable) => {
            const knowledge = requireSources([], unavailable);
            const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
            expect(mockLlmProvider.generateAnswer).not.toHaveBeenCalled();
            expect(result.assistantMessage.modelName).toBe('source-policy');
            expect(result.assistantMessage.citations).toEqual([]);
            expect(result.assistantMessage.content).toContain(
              unavailable ? 'library was unavailable' : 'do not provide usable source evidence',
            );
            expect(await service.postMessage(mockProjectId, mockUserId, 'conv-1', request)).toEqual(
              result,
            );
            expect(knowledge.retrieve).toHaveBeenCalledTimes(1);
          },
        );
        it.each(['missing', 'forged', 'stale-number'])(
          'withholds a draft with %s citations',
          async (kind) => {
            requireSources();
            mockLlmProvider.generateAnswer.mockResolvedValue({
              content:
                'Unsupported recommendation' +
                (kind === 'stale-number' ? ' [Evidence #99]' : ' [Evidence #1]'),
              citations:
                kind === 'missing'
                  ? []
                  : kind === 'forged'
                    ? [{ ...source, chunkId: 'forged' }]
                    : [source],
              modelName: 'test',
              promptTokens: 20,
              completionTokens: 10,
            });
            const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
            expect(result.assistantMessage.content).toContain('withheld the unsupported draft');
            expect(result.assistantMessage.content).not.toContain('Unsupported recommendation');
            expect(result.assistantMessage.citations).toEqual([]);
            expect(result.assistantMessage.completionTokens).toBe(10);
            expect(saved.find((m) => m.role === 'assistant')!.content).toBe(
              result.assistantMessage.content,
            );
          },
        );
        it('can answer from project evidence during a reference outage while disclosing it', async () => {
          requireSources([], true);
          const local = { ...source, sourceType: KnowledgeSourceType.DOCUMENT };
          mockRetrievalService.retrieve.mockResolvedValue([local]);
          mockLlmProvider.generateAnswer.mockResolvedValue({
            content: 'Recorded project information [Evidence #1].',
            citations: [local],
            modelName: 'test',
          });
          const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
          expect(result.assistantMessage.content).toContain('sources were unavailable');
          expect(result.assistantMessage.citations[0]?.sourceType).toBe('DOCUMENT');
        });
        it('keeps pure courtesy usable without inventing a sourced business lesson', async () => {
          const knowledge = requireSources([], true);
          const result = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
            ...request,
            content: 'Thank you!',
          });
          expect(knowledge.retrieve).toHaveBeenCalled();
          expect(mockLlmProvider.generateAnswer).not.toHaveBeenCalled();
          expect(result.assistantMessage.content).toBe("You're welcome.");
        });
        it('does not replay a previously optional answer after required-source policy changes', async () => {
          await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
          requireSources();
          await expect(
            service.postMessage(mockProjectId, mockUserId, 'conv-1', request),
          ).rejects.toThrow(ConflictException);
          expect(mockLlmProvider.generateAnswer).toHaveBeenCalledTimes(1);
        });
      });

      it('replays omitted and explicit unified scopes but rejects narrowing a saved request', async () => {
        const knowledge = {
          retrieve: jest.fn().mockResolvedValue({ evidence: [], unavailable: false }),
        };
        Object.assign(service, { knowledge });
        const unified = { ...request, includeKnowledge: true };
        const first = await service.postMessage(mockProjectId, mockUserId, 'conv-1', unified);
        const replay = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
          ...unified,
          knowledgeScope: 'all',
        });
        expect(replay).toEqual(first);
        expect(knowledge.retrieve).toHaveBeenCalledTimes(1);
        expect(knowledge.retrieve).toHaveBeenCalledWith(request.content, mockUserId, 'all');
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', {
            ...unified,
            knowledgeScope: 'mba',
          }),
        ).rejects.toThrow(ConflictException);
      });

      it('replays a saved response after delivery is lost without another provider call or message', async () => {
        const first = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        const retry = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        expect(retry).toEqual(first);
        expect(saved).toHaveLength(2);
        expect(mockLlmProvider.generateAnswer).toHaveBeenCalledTimes(1);
      });
      it('persists the complete model-used evidence separately from claimed citations and replays it unchanged', async () => {
        const evidence = {
          chunkId: 'audit-chunk',
          sourceId: 'audit-doc',
          sourceType: KnowledgeSourceType.DOCUMENT,
          title: 'Synthetic plan',
          revision: 2,
          locator: 'Section',
          text: 'A source-backed constraint.',
          snippet: 'A source-backed constraint.',
          score: 1,
        };
        mockRetrievalService.retrieve.mockResolvedValue([evidence]);
        const first = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        const snapshot = first.assistantMessage.evidenceSnapshot;
        expect(snapshot).toMatchObject({
          version: 1,
          generationAttempted: true,
          items: [
            expect.objectContaining({
              chunkId: evidence.chunkId,
              revision: 2,
              evidenceNumber: 1,
              exactExcerpt: evidence.text,
            }),
          ],
        });
        expect(snapshot!.items[0]!.textSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(first.assistantMessage.citations).toEqual([]);
        const replay = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        expect(replay.assistantMessage.evidenceSnapshot).toEqual(snapshot);
        expect(mockLlmProvider.generateAnswer).toHaveBeenCalledTimes(1);
      });
      it('resumes retrieval failure without duplicating the user turn', async () => {
        mockRetrievalService.retrieve.mockRejectedValueOnce(new Error('Synthetic outage'));
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', request),
        ).rejects.toThrow();
        expect(saved).toHaveLength(1);
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        expect(saved).toHaveLength(2);
        expect(saved.filter((message) => message.role === 'user')).toHaveLength(1);
      });
      it('retries a failed answer in place, preserving the saved user and assistant IDs', async () => {
        mockLlmProvider.generateAnswer.mockRejectedValueOnce(
          new Error('Synthetic provider failure'),
        );
        const failed = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        expect(failed.assistantMessage.status).toBe('FAILED');
        const retry = await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        expect(retry.userMessage.id).toBe(failed.userMessage.id);
        expect(retry.assistantMessage.id).toBe(failed.assistantMessage.id);
        expect(retry.assistantMessage.status).toBe('COMPLETED');
        expect(saved).toHaveLength(2);
      });
      it('rejects reuse with changed content and does not expose a foreign conversation', async () => {
        await service.postMessage(mockProjectId, mockUserId, 'conv-1', request);
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', {
            ...request,
            content: 'Different question',
          }),
        ).rejects.toMatchObject({ response: { code: 'CHAT_REQUEST_CONFLICT' } });
        mockConversationRepo.findOne.mockResolvedValue(null);
        await expect(
          service.postMessage(mockProjectId, 'foreign-user', 'conv-1', request),
        ).rejects.toThrow(NotFoundException);
        expect(mockLlmProvider.generateAnswer).toHaveBeenCalledTimes(1);
      });
      it('rejects stale unfinished turns after a newer user message', async () => {
        mockRetrievalService.retrieve.mockRejectedValueOnce(new Error('Synthetic outage'));
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', request),
        ).rejects.toThrow();
        saved.push({ ...saved[0]!, id: 'newer-user', clientRequestId: null });
        await expect(
          service.postMessage(mockProjectId, mockUserId, 'conv-1', request),
        ).rejects.toMatchObject({ response: { code: 'CHAT_RETRY_STALE' } });
        expect(mockLlmProvider.generateAnswer).not.toHaveBeenCalled();
      });
    });
    it('uses durable all-project scope on later turns even when a client omits or sends false', async () => {
      const conv = {
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'Workspace chat',
        defaultMode: AssistantMode.WORKSPACE,
        includeAllWorkspaces: true,
      };
      mockConversationRepo.findOne.mockResolvedValue(conv);
      mockProjectMemberRepo.find.mockResolvedValue([
        { projectId: mockProjectId },
        { projectId: 'other-member-project' },
      ]);
      mockLlmProvider.generateAnswer.mockResolvedValue({
        content: 'Done',
        citations: [],
        modelName: 'test',
        promptTokens: 1,
        completionTokens: 1,
      });
      await service.postMessage(mockProjectId, mockUserId, conv.id, {
        content: 'Compare project context',
      });
      await service.postMessage(mockProjectId, mockUserId, conv.id, {
        content: 'Continue',
        includeAllWorkspaces: false,
      });
      expect(mockRetrievalService.retrieve).toHaveBeenCalledTimes(2);
      for (const [params] of mockRetrievalService.retrieve.mock.calls) {
        expect(params.projectIds).toEqual([mockProjectId, 'other-member-project']);
        expect(params.actorId).toBe(mockUserId);
      }
      expect(conv.includeAllWorkspaces).toBe(true);
    });

    it('identifies retrieval failure without exposing database details or invoking the model', async () => {
      mockConversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        title: 'Work',
        defaultMode: AssistantMode.WORKSPACE,
      });
      mockRetrievalService.retrieve.mockRejectedValue(new Error('private database detail'));
      await expect(
        service.postMessage(mockProjectId, mockUserId, 'conv-1', {
          content: 'Analyze this project.',
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'AI_RETRIEVAL_FAILED',
          message: 'Project search could not complete. Your request is saved; please retry.',
        },
      });
      expect(mockMessageRepo.save).toHaveBeenCalledTimes(1);
      expect(mockLlmProvider.generateAnswer).not.toHaveBeenCalled();
    });

    it('loads only actor/project memory before the provider call and keeps it separate from citations', async () => {
      mockConversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        title: 'Work',
        defaultMode: AssistantMode.WORKSPACE,
      });
      mockMemoryService.select.mockResolvedValue([
        {
          id: 'memory-1',
          kind: SavedMemoryKind.LESSON,
          content: 'Verify cash-flow assumptions against the source filing.',
          version: 1,
        },
      ]);
      mockLlmProvider.generateAnswer.mockResolvedValue({
        content: 'Here are the assumptions.',
        citations: [],
        modelName: 'test',
      });
      await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
        content: 'Analyze this project.',
      });
      expect(mockMemoryService.select).toHaveBeenCalledWith(
        mockProjectId,
        mockUserId,
        expect.any(String),
      );
      const input = mockLlmProvider.generateAnswer.mock.calls[0]![0];
      expect(input.messages[0].content).toContain('Verify cash-flow assumptions');
      expect(input.messages[0].content).toContain('UNTRUSTED CONTEXT');
      expect(input.evidence).toEqual([]);
    });

    it('does not contact the provider when memory access is revoked', async () => {
      mockConversationRepo.findOne.mockResolvedValue({ id: 'conv-1', title: 'Work' });
      mockMemoryService.select.mockRejectedValue(new NotFoundException('Project not found'));
      await expect(
        service.postMessage(mockProjectId, mockUserId, 'conv-1', { content: 'Work' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockLlmProvider.generateAnswer).not.toHaveBeenCalled();
    });
    it('orchestrates retrieval, context assembly, LLM generation, and citation validation', async () => {
      const mockConv = {
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'New Conversation',
        defaultMode: AssistantMode.PM,
        updatedAt: new Date(),
      };
      mockConversationRepo.findOne.mockResolvedValue(mockConv);

      const mockEvidence: RetrievedEvidence[] = [
        {
          chunkId: 'uncited-chunk',
          sourceId: 'src-0',
          sourceType: KnowledgeSourceType.DOCUMENT,
          title: 'Other context',
          revision: 1,
          locator: 'Chunk #0',
          snippet: 'Uncited information',
          score: 1,
        },
        {
          chunkId: 'chunk-valid-1',
          sourceId: 'src-1',
          sourceType: KnowledgeSourceType.REQUIREMENT,
          title: 'PostgreSQL Vector Search',
          revision: 1,
          locator: 'Chunk #1',
          snippet: 'pgvector provides cosine distance indexing.',
          score: 0.95,
        },
      ];
      mockRetrievalService.retrieve.mockResolvedValue(mockEvidence);

      mockLlmProvider.generateAnswer.mockResolvedValue({
        content: 'PostgreSQL uses pgvector for embeddings. [Evidence #2]',
        citations: [
          {
            chunkId: 'chunk-valid-1',
            sourceId: 'forged-source-id',
            sourceType: KnowledgeSourceType.REQUIREMENT,
            title: 'PostgreSQL Vector Search',
            revision: 1,
          },
          {
            // Hallucinated citation that was NOT in retrieved evidence
            chunkId: 'chunk-fake-99',
            sourceId: 'fake',
            sourceType: 'DOCUMENT',
            title: 'Fake Document',
            revision: 1,
          },
        ],
        modelName: 'deepseek-flash',
        promptTokens: 120,
        completionTokens: 50,
      });

      const { userMessage, assistantMessage } = await service.postMessage(
        mockProjectId,
        mockUserId,
        'conv-1',
        { content: 'Tell me about pgvector' },
      );

      expect(userMessage.content).toBe('Tell me about pgvector');
      expect(assistantMessage.content).toBe(
        'PostgreSQL uses pgvector for embeddings. [Evidence #2]',
      );
      expect(assistantMessage.status).toBe(MessageStatus.COMPLETED);

      // Verify citation validation filtered out chunk-fake-99
      expect(assistantMessage.citations).toHaveLength(1);
      expect(assistantMessage.citations[0]!.chunkId).toBe('chunk-valid-1');
      expect(assistantMessage.citations[0]!.evidenceNumber).toBe(2);
      expect(assistantMessage.citations[0]!.sourceId).toBe('src-1');
    });

    it('handles LLM generation failure gracefully with FAILED message status', async () => {
      const mockConv = {
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'New Conversation',
        defaultMode: AssistantMode.PM,
        updatedAt: new Date(),
      };
      mockConversationRepo.findOne.mockResolvedValue(mockConv);
      mockRetrievalService.retrieve.mockResolvedValue([]);
      mockLlmProvider.generateAnswer.mockRejectedValue(new Error('DeepSeek API connection error'));

      const { assistantMessage } = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
        content: 'Query that fails',
      });

      expect(assistantMessage.status).toBe(MessageStatus.FAILED);
      expect(assistantMessage.content).toContain('An error occurred while generating the response');
    });

    it('retrieves evidence across multiple workspaces and attaches project metadata to citations when includeAllWorkspaces is true', async () => {
      mockMemoryService.select.mockResolvedValue([
        {
          id: 'own-memory',
          kind: SavedMemoryKind.PREFERENCE,
          content: 'Compare assumptions before deciding.',
          version: 1,
        },
      ]);
      const mockConv = {
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'New Conversation',
        defaultMode: AssistantMode.PM,
        updatedAt: new Date(),
      };
      mockConversationRepo.findOne.mockResolvedValue(mockConv);
      mockProjectMemberRepo.find.mockResolvedValue([
        { projectId: mockProjectId },
        { projectId: 'proj-2222-2222' },
      ]);

      const multiEvidence: RetrievedEvidence[] = [
        {
          chunkId: 'chunk-p1',
          sourceId: 'src-1',
          sourceType: KnowledgeSourceType.REQUIREMENT,
          title: 'Project 1 Spec',
          revision: 1,
          locator: 'Chunk #1',
          snippet: 'Spec for project 1',
          projectName: 'Project 1',
          projectKey: 'P1',
          score: 0.9,
        },
        {
          chunkId: 'chunk-p2',
          sourceId: 'src-2',
          sourceType: KnowledgeSourceType.DOCUMENT,
          title: 'Project 2 Architecture',
          revision: 1,
          locator: 'Chunk #2',
          snippet: 'Architecture for project 2',
          projectName: 'Project 2',
          projectKey: 'P2',
          score: 0.85,
        },
      ];
      mockRetrievalService.retrieve.mockResolvedValue(multiEvidence);

      mockLlmProvider.generateAnswer.mockResolvedValue({
        content: 'Cross project summary citing both. [Evidence #1] [Evidence #2]',
        citations: [
          {
            chunkId: 'chunk-p1',
            sourceId: 'src-1',
            sourceType: KnowledgeSourceType.REQUIREMENT,
            title: 'Project 1 Spec',
            revision: 1,
          },
          {
            chunkId: 'chunk-p2',
            sourceId: 'src-2',
            sourceType: KnowledgeSourceType.DOCUMENT,
            title: 'Project 2 Architecture',
            revision: 1,
          },
        ],
        modelName: 'deepseek-flash',
        promptTokens: 150,
        completionTokens: 80,
      });

      const { assistantMessage } = await service.postMessage(mockProjectId, mockUserId, 'conv-1', {
        content: 'Compare both projects',
        includeAllWorkspaces: true,
      });

      expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          projectIds: [mockProjectId, 'proj-2222-2222'],
          limit: 12,
        }),
      );
      expect(assistantMessage.citations).toHaveLength(2);
      expect(assistantMessage.citations[0]!.projectName).toBe('Project 1');
      expect(assistantMessage.citations[0]!.projectKey).toBe('P1');
      expect(assistantMessage.citations[1]!.projectName).toBe('Project 2');
      expect(assistantMessage.citations[1]!.projectKey).toBe('P2');
      expect(mockMemoryService.select).toHaveBeenCalledTimes(1);
      expect(mockMemoryService.select).toHaveBeenCalledWith(
        mockProjectId,
        mockUserId,
        expect.any(String),
      );
      const systemPrompt = mockLlmProvider.generateAnswer.mock.calls[0]![0].messages[0].content;
      expect(systemPrompt).toContain('across all authorized project workspaces');
      expect(systemPrompt).toContain('Compare assumptions before deciding.');
      expect(systemPrompt).toContain('Workspace: [P2] Project 2');
    });

    it('retrieves evidence across all system projects when user is ADMIN and includeAllWorkspaces is true', async () => {
      const mockConv = {
        id: 'conv-admin',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'Admin Conversation',
        defaultMode: AssistantMode.PM,
        updatedAt: new Date(),
      };
      mockConversationRepo.findOne.mockResolvedValue(mockConv);
      mockUserRepo.findOne.mockResolvedValue({ id: mockUserId, systemRole: SystemRole.ADMIN });
      mockProjectRepo.find.mockResolvedValue([
        { id: mockProjectId },
        { id: 'proj-admin-2' },
        { id: 'proj-admin-3' },
      ]);
      mockRetrievalService.retrieve.mockResolvedValue([]);
      mockLlmProvider.generateAnswer.mockResolvedValue({
        content: 'Overview for all 3 projects',
        citations: [],
        modelName: 'deepseek-flash',
      });

      await service.postMessage(mockProjectId, mockUserId, 'conv-admin', {
        content: 'System wide overview',
        includeAllWorkspaces: true,
      });

      expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          projectIds: [mockProjectId, 'proj-admin-2', 'proj-admin-3'],
          limit: 12,
        }),
      );
    });
  });
});
