import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ProjectsService } from '../../src/modules/projects/projects.service';
import { Project } from '../../src/modules/projects/entities/project.entity';
import {
  ProjectMember,
  ProjectRole,
} from '../../src/modules/projects/entities/project-member.entity';
import { AuditService } from '../../src/modules/audit/audit.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectRepo: jest.Mocked<Repository<Project>>;
  let memberRepo: jest.Mocked<Repository<ProjectMember>>;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(() => {
    projectRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (p: Project) => p),
    } as unknown as jest.Mocked<Repository<Project>>;

    memberRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<ProjectMember>>;

    auditService = {
      record: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    dataSource = {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => {
        const manager = {
          create: jest.fn((_type: unknown, dto: object) => ({ id: 'new-id', ...dto })),
          save: jest.fn(async (_type: unknown, entity: unknown) => entity),
          findOne: jest.fn(async () => null),
        };
        return cb(manager);
      }),
    } as unknown as jest.Mocked<DataSource>;

    service = new ProjectsService(projectRepo, memberRepo, auditService, dataSource);
  });

  it('rejects duplicate project keys with ConflictException', async () => {
    projectRepo.findOne.mockResolvedValue({ id: 'existing-proj' } as Project);

    await expect(
      service.createProject('user-1', {
        key: 'AIW',
        name: 'Existing Key Project',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates project and assigns creator as OWNER transactionally', async () => {
    projectRepo.findOne.mockResolvedValue(null);

    const result = await service.createProject('user-1', {
      key: 'NEWPRJ',
      name: 'New Project',
      description: 'Desc',
    });

    expect(result.project.key).toBe('NEWPRJ');
    expect(result.accessRole).toBe(ProjectRole.OWNER);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROJECT_CREATED' }),
      expect.anything(),
    );
  });

  it('creates project with invited initial members', async () => {
    projectRepo.findOne.mockResolvedValue(null);
    let capturedManager!: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
    (dataSource.transaction as jest.Mock).mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => {
        capturedManager = {
          create: jest.fn((_type: unknown, dto: object) => ({ id: 'new-id', ...dto })),
          save: jest.fn(async (_type: unknown, entity: unknown) => entity),
          findOne: jest.fn(async (_entity: unknown, opts: { where?: { id?: string } }) => {
            if (opts?.where?.id === 'invited-user-1') {
              return { id: 'invited-user-1', email: 'colleague@example.com', isActive: true };
            }
            return null;
          }),
        };
        return cb(capturedManager);
      },
    );

    const result = await service.createProject('user-1', {
      key: 'TEAMPRJ',
      name: 'Team Project',
      members: [
        { userId: 'invited-user-1', role: ProjectRole.CONTRIBUTOR },
        { userId: 'user-1' }, // Should be ignored since user-1 is creator
      ],
    });

    expect(result.project.key).toBe('TEAMPRJ');
    expect(capturedManager.create).toHaveBeenCalledWith(
      ProjectMember,
      expect.objectContaining({
        userId: 'invited-user-1',
        accessRole: ProjectRole.CONTRIBUTOR,
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MEMBER_ADDED',
        entityId: 'invited-user-1',
      }),
      expect.anything(),
    );
  });

  it('rejects update with version mismatch for optimistic concurrency', async () => {
    projectRepo.findOne.mockResolvedValue({
      id: 'proj-1',
      version: 2,
    } as Project);

    await expect(
      service.updateProject('proj-1', 'user-1', {
        name: 'New Name',
        version: 1, // Mismatched version
      }),
    ).rejects.toThrow(ConflictException);
  });
});
