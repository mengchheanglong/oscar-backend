import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AiService } from '../../src/modules/ai/ai.service';
import { ContextAssembler } from '../../src/modules/ai/context/context-assembler';
import { AiMode } from '../../src/modules/ai/entities/ai-mode.enum';
import { ChatMessage, MessageStatus } from '../../src/modules/ai/entities/chat-message.entity';
import { Conversation } from '../../src/modules/ai/entities/conversation.entity';
import { LlmProvider } from '../../src/modules/ai/llm/llm-provider.interface';
import {
  RetrievalService,
  RetrievedEvidence,
} from '../../src/modules/ai/retrieval/retrieval.service';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service';
import { KnowledgeSourceType } from '../../src/modules/ingestion/entities';
import { ProjectMember } from '../../src/modules/projects/entities/project-member.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import { CopilotMemoryService } from '../../src/modules/ai/copilot-memory.service';
import { CopilotMemoryKind } from '../../src/modules/ai/entities/copilot-memory.entity';
import { SystemRole, User } from '../../src/modules/users/entities/user.entity';

describe('AiService', () => {
  let service: AiService;
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
  };
  let mockIngestionService: {
    getEmbeddingProvider: jest.Mock;
  };
  let mockMemoryService: { list: jest.Mock };

  const mockProjectId = 'proj-1111-1111';
  const mockUserId = 'user-2222-2222';

  beforeEach(() => {
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
    };

    mockIngestionService = {
      getEmbeddingProvider: jest.fn().mockReturnValue(null),
    };
    mockMemoryService = { list: jest.fn().mockResolvedValue([]) };

    service = new AiService(
      mockConversationRepo as unknown as Repository<Conversation>,
      mockMessageRepo as unknown as Repository<ChatMessage>,
      mockProjectRepo as unknown as Repository<Project>,
      mockProjectMemberRepo as unknown as Repository<ProjectMember>,
      mockUserRepo as unknown as Repository<User>,
      mockRetrievalService as unknown as RetrievalService,
      contextAssembler,
      mockLlmProvider as unknown as LlmProvider,
      mockIngestionService as unknown as IngestionService,
      mockMemoryService as unknown as CopilotMemoryService,
    );
  });

  describe('createConversation', () => {
    it('creates a new conversation successfully', async () => {
      const result = await service.createConversation(mockProjectId, mockUserId, {
        title: 'Q&A on sprint',
        defaultMode: AiMode.DEVELOPER,
      });

      expect(mockProjectRepo.findOne).toHaveBeenCalledWith({ where: { id: mockProjectId } });
      expect(mockConversationRepo.create).toHaveBeenCalledWith({
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'Q&A on sprint',
        defaultMode: AiMode.DEVELOPER,
      });
      expect(result.id).toBe('conv-1');
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
    it('identifies retrieval failure without exposing database details or invoking the model', async () => {
      mockConversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        title: 'Work',
        defaultMode: AiMode.WORKSPACE,
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
        defaultMode: AiMode.WORKSPACE,
      });
      mockMemoryService.list.mockResolvedValue([
        {
          id: 'memory-1',
          kind: CopilotMemoryKind.LESSON,
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
      expect(mockMemoryService.list).toHaveBeenCalledWith(mockProjectId, mockUserId, 8);
      const input = mockLlmProvider.generateAnswer.mock.calls[0]![0];
      expect(input.messages[0].content).toContain('Verify cash-flow assumptions');
      expect(input.messages[0].content).toContain('UNTRUSTED CONTEXT');
      expect(input.evidence).toEqual([]);
    });

    it('does not contact the provider when memory access is revoked', async () => {
      mockConversationRepo.findOne.mockResolvedValue({ id: 'conv-1', title: 'Work' });
      mockMemoryService.list.mockRejectedValue(new NotFoundException('Project not found'));
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
        defaultMode: AiMode.PM,
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
            sourceId: 'src-1',
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
    });

    it('handles LLM generation failure gracefully with FAILED message status', async () => {
      const mockConv = {
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'New Conversation',
        defaultMode: AiMode.PM,
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
      mockMemoryService.list.mockResolvedValue([
        {
          id: 'own-memory',
          kind: CopilotMemoryKind.PREFERENCE,
          content: 'Compare assumptions before deciding.',
          version: 1,
        },
      ]);
      const mockConv = {
        id: 'conv-1',
        projectId: mockProjectId,
        userId: mockUserId,
        title: 'New Conversation',
        defaultMode: AiMode.PM,
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
      expect(mockMemoryService.list).toHaveBeenCalledTimes(1);
      expect(mockMemoryService.list).toHaveBeenCalledWith(mockProjectId, mockUserId, 8);
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
        defaultMode: AiMode.PM,
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
