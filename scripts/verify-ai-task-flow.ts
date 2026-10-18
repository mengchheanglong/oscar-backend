import 'reflect-metadata';
import 'dotenv/config';
import { mockVerificationDatabaseUrl } from './mock-verification-database';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';
import { ProposalsService } from '../src/modules/ai/proposals.service';
import { AIProposal, ProposalStatus } from '../src/modules/ai/entities/proposal.entity';
import { ProposalCommit } from '../src/modules/ai/entities/proposal-commit.entity';
import { Requirement, Priority } from '../src/modules/requirements/entities/requirement.entity';
import { Decision } from '../src/modules/decisions/entities/decision.entity';
import { Task } from '../src/modules/tasks/entities/task.entity';
import { Meeting } from '../src/modules/meetings/entities/meeting.entity';
import { Project, ProjectStatus } from '../src/modules/projects/entities/project.entity';
import { ProjectMember, ProjectRole } from '../src/modules/projects/entities/project-member.entity';
import { User, SystemRole } from '../src/modules/users/entities/user.entity';
import { MockLlmProvider } from '../src/modules/ai/llm/mock-llm-provider';
import { RetrievalService } from '../src/modules/ai/retrieval/retrieval.service';
import { ContextAssembler } from '../src/modules/ai/context/context-assembler';
import { ConflictException, ForbiddenException } from '@nestjs/common';

async function run() {
  console.log('========================================================================');
  console.log('  AI TASK GENERATION & REFINEMENT VERIFICATION HARNESS');
  console.log('========================================================================\n');

  const url = mockVerificationDatabaseUrl();
  const dataSource = new DataSource(databaseOptions(url));
  await dataSource.initialize();
  console.log('Database connection established for isolated verification.');

  const mockAuditService = { record: async () => {} };
  const mockOutboxService = { emit: async () => {} };
  const mockLlmProvider = new MockLlmProvider();

  const proposalsService = new ProposalsService(
    dataSource.getRepository(AIProposal),
    dataSource.getRepository(ProposalCommit),
    dataSource.getRepository(Requirement),
    dataSource.getRepository(Meeting),
    dataSource.getRepository(Decision),
    dataSource.getRepository(Project),
    dataSource.getRepository(ProjectMember),
    mockLlmProvider,
    mockAuditService as never,
    mockOutboxService as never,
    dataSource,
    new RetrievalService(dataSource),
    new ContextAssembler(),
  );

  const userRepo = dataSource.getRepository(User);
  const projectRepo = dataSource.getRepository(Project);
  const memberRepo = dataSource.getRepository(ProjectMember);
  const reqRepo = dataSource.getRepository(Requirement);
  const meetingRepo = dataSource.getRepository(Meeting);
  const taskRepo = dataSource.getRepository(Task);
  const decisionRepo = dataSource.getRepository(Decision);

  try {
    // ── Setup Actor & Project ──
    console.log('\n[Phase 1] Setting up Test Actor, Viewer, and Project...');
    const testEmail = `lead-${Date.now()}@example.com`;
    const user = await userRepo.save(
      userRepo.create({
        email: testEmail,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        displayName: 'Lead Engineer',
        systemRole: SystemRole.USER,
        isActive: true,
      }),
    );

    const viewerEmail = `viewer-${Date.now()}@example.com`;
    const viewer = await userRepo.save(
      userRepo.create({
        email: viewerEmail,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
        displayName: 'Auditor Viewer',
        systemRole: SystemRole.USER,
        isActive: true,
      }),
    );

    const projectKey = `PRJ${Math.floor(Math.random() * 899 + 100)}`;
    const project = await projectRepo.save(
      projectRepo.create({
        name: 'AI Task Generation Test Workspace',
        key: projectKey,
        description: 'Testing task proposal edge cases and linkages',
        status: ProjectStatus.ACTIVE,
        createdBy: user.id,
      }),
    );

    await memberRepo.save(
      memberRepo.create({
        projectId: project.id,
        userId: user.id,
        accessRole: ProjectRole.MANAGER,
      }),
    );

    await memberRepo.save(
      memberRepo.create({
        projectId: project.id,
        userId: viewer.id,
        accessRole: ProjectRole.VIEWER,
      }),
    );
    console.log(
      `✓ Project created (${project.key}) with Manager: ${user.email} and Viewer: ${viewer.email}`,
    );

    // ── Scenario A: Requirement Task Generation & Draft Editing ──
    console.log('\n[Phase 2] Testing Requirement Task Generation & Draft Editing Flow...');
    const requirement = await reqRepo.save(
      reqRepo.create({
        projectId: project.id,
        number: 1,
        title: 'Edge Sensor Telemetry Streaming',
        description:
          'Stream telemetry packets over TLS 1.3 with Protobuf encoding and gzip compression.',
        acceptanceCriteria: '1. MQTT client connects on port 8883. 2. Telemetry sent every 500ms.',
        priority: Priority.HIGH,
        createdBy: user.id,
        updatedBy: user.id,
        version: 1,
      }),
    );

    // 1. Generate Task Proposal
    const proposal = await proposalsService.generateTaskProposal(
      project.id,
      user.id,
      requirement.id,
    );
    console.log(
      `✓ AI Task Proposal generated: id=${proposal.id}, status=${proposal.status}, version=${proposal.version}`,
    );
    if (proposal.status !== ProposalStatus.PENDING || proposal.version !== 1) {
      throw new Error(
        `Expected PENDING version 1, got status=${proposal.status}, version=${proposal.version}`,
      );
    }

    const draft = proposal.draftJson as {
      type: string;
      items: Array<{ itemId: string; title: string; priority: string; description: string }>;
    };
    console.log(`  Draft contains ${draft.items.length} proposed items:`);
    draft.items.forEach((item, i) => console.log(`   [${i + 1}] ${item.title} (${item.priority})`));

    // 2. Edit Draft Before Approval
    console.log(
      '\n  Editing draft tasks before approval (Refining Item 1 and changing Priority to URGENT)...',
    );
    const originalItemId = draft.items[0]!.itemId;
    draft.items[0]!.title = 'Refined: High-Throughput Edge Telemetry Pipeline';
    draft.items[0]!.description =
      'Production-ready MQTT handler with reconnect and backpressure logic.';
    draft.items[0]!.priority = 'URGENT';

    // Optimistic locking check: stale update attempt with version 99 must fail
    let optimisticLockCaught = false;
    try {
      await proposalsService.updateProposal(project.id, user.id, proposal.id, {
        version: 99,
        draftJson: draft,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        optimisticLockCaught = true;
        console.log(
          '  ✓ Optimistic concurrency correctly rejected stale version update (HTTP 409)',
        );
      }
    }
    if (!optimisticLockCaught) throw new Error('Failed to reject stale update');

    // Valid draft update
    const updatedProposal = await proposalsService.updateProposal(
      project.id,
      user.id,
      proposal.id,
      {
        version: 1,
        draftJson: draft,
      },
    );
    console.log(`  ✓ Draft updated successfully: new version=${updatedProposal.version}`);
    if (updatedProposal.version !== 2) throw new Error('Version did not increment to 2');

    // ── Scenario B: Duplicate Submissions & Idempotency ──
    console.log('\n[Phase 3] Testing Duplicate Submissions, Idempotency & Payload Mismatch...');
    const idemKey = `idem-key-${Date.now()}`;

    // First confirmation: confirm only item 1
    const confirmResult1 = await proposalsService.confirmProposal(
      project.id,
      user,
      proposal.id,
      { version: 2, selectedItemIds: [originalItemId] },
      idemKey,
    );
    console.log(
      `✓ Proposal confirmed: status=${confirmResult1.proposal.status}, resultRecords=`,
      confirmResult1.resultRecordIds,
    );

    const taskCountAfterFirst = await taskRepo.count({ where: { projectId: project.id } });
    console.log(`  Total tasks in database after confirmation: ${taskCountAfterFirst}`);

    // Replay exact same request with same Idempotency-Key
    console.log('  Replaying duplicate confirmation with identical Idempotency-Key...');
    const confirmResult2 = await proposalsService.confirmProposal(
      project.id,
      user,
      proposal.id,
      { version: 2, selectedItemIds: [originalItemId] },
      idemKey,
    );
    const taskCountAfterReplay = await taskRepo.count({ where: { projectId: project.id } });
    if (taskCountAfterReplay !== taskCountAfterFirst) {
      throw new Error(
        `Duplicate task created! Expected count ${taskCountAfterFirst}, got ${taskCountAfterReplay}`,
      );
    }
    console.log(
      `  ✓ Idempotent replay succeeded: zero duplicate records created (count=${taskCountAfterReplay})`,
    );
    if (confirmResult2.resultRecordIds[0]!.id !== confirmResult1.resultRecordIds[0]!.id) {
      throw new Error('Replayed result record ID mismatch');
    }

    // Replay with same key but DIFFERENT payload (must throw ConflictException)
    console.log('  Submitting same Idempotency-Key with mismatched payload...');
    let payloadMismatchCaught = false;
    try {
      await proposalsService.confirmProposal(
        project.id,
        user,
        proposal.id,
        { version: 2, selectedItemIds: ['different-item-id'] },
        idemKey,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        payloadMismatchCaught = true;
        console.log('  ✓ Idempotency payload mismatch correctly rejected with ConflictException');
      }
    }
    if (!payloadMismatchCaught) throw new Error('Failed to reject payload mismatch');

    // ── Scenario C: Source Requirement Linkage Verification ──
    console.log('\n[Phase 4] Verifying Task Linkage Back to Source Requirement...');
    const createdTaskId = confirmResult1.resultRecordIds[0]!.id;
    const verifiedTask = await taskRepo.findOne({ where: { id: createdTaskId } });
    if (!verifiedTask) throw new Error('Created task not found in database');

    console.log(`  Created Task Details:`);
    console.log(`   - Key: ${project.key}-TSK-${verifiedTask.number}`);
    console.log(`   - Title: "${verifiedTask.title}"`);
    console.log(`   - Priority: ${verifiedTask.priority}`);
    console.log(`   - Requirement ID: ${verifiedTask.requirementId} (expected: ${requirement.id})`);
    console.log(`   - Source Meeting ID: ${verifiedTask.sourceMeetingId} (expected: null)`);

    if (verifiedTask.requirementId !== requirement.id) {
      throw new Error(
        `Task requirement link mismatch: expected ${requirement.id}, got ${verifiedTask.requirementId}`,
      );
    }
    if (verifiedTask.sourceMeetingId !== null) {
      throw new Error(`Task sourceMeetingId should be null for requirement tasks`);
    }
    if (verifiedTask.title !== 'Refined: High-Throughput Edge Telemetry Pipeline') {
      throw new Error('Task title did not reflect edited draft');
    }
    if (verifiedTask.priority !== 'URGENT') {
      throw new Error('Task priority did not reflect edited draft');
    }
    console.log('  ✓ Requirement task link and edited values verified in PostgreSQL!');

    // ── Scenario D: Meeting Analysis & Action Item Linkage ──
    console.log('\n[Phase 5] Testing Meeting Analysis & Meeting Linkage Verification...');
    const meeting = await meetingRepo.save(
      meetingRepo.create({
        projectId: project.id,
        title: 'Quarterly Architecture Sync',
        startsAt: new Date('2026-09-18T10:00:00Z'),
        endsAt: new Date('2026-09-18T11:00:00Z'),
        agenda: 'Review database partitioning, vector retrieval, and rollout plan',
        notes: 'Decided to adopt pgvector for search. Assigned Bob to build migration script.',
        transcriptText:
          'Alice: We need to finalize pgvector. Bob: I will write the migration script by Friday. Alice: Approved.',
        transcriptVersion: 1,
        createdBy: user.id,
        updatedBy: user.id,
      }),
    );

    const meetingProposal = await proposalsService.generateMeetingAnalysis(
      project.id,
      user.id,
      meeting.id,
    );
    console.log(
      `✓ Meeting analysis proposal generated: id=${meetingProposal.id}, version=${meetingProposal.version}`,
    );

    const meetingIdemKey = `idem-meeting-${Date.now()}`;
    const meetingConfirmRes = await proposalsService.confirmProposal(
      project.id,
      user,
      meetingProposal.id,
      { version: 1, includeSummary: true },
      meetingIdemKey,
    );
    console.log(`✓ Meeting proposal confirmed: resultRecords=`, meetingConfirmRes.resultRecordIds);

    // Verify Meeting Action Item Tasks link to sourceMeetingId
    const meetingTaskResult = meetingConfirmRes.resultRecordIds.find(
      (r: { entityType: string }) => r.entityType === 'TASK',
    );
    if (!meetingTaskResult) throw new Error('No task generated from meeting analysis');
    const meetingTask = await taskRepo.findOne({ where: { id: meetingTaskResult.id } });
    if (!meetingTask) throw new Error('Meeting task not found in database');

    console.log(`  Meeting Action Item Task:`);
    console.log(`   - Key: ${meetingTaskResult.key}`);
    console.log(`   - Title: "${meetingTask.title}"`);
    console.log(`   - Source Meeting ID: ${meetingTask.sourceMeetingId} (expected: ${meeting.id})`);
    console.log(`   - Requirement ID: ${meetingTask.requirementId} (expected: null)`);

    if (meetingTask.sourceMeetingId !== meeting.id) {
      throw new Error(`Meeting task did not link to source meeting ID`);
    }
    if (meetingTask.requirementId !== null) {
      throw new Error(`Meeting task should have null requirementId`);
    }

    // Verify Decision links to sourceMeetingId
    const meetingDecResult = meetingConfirmRes.resultRecordIds.find(
      (r: { entityType: string }) => r.entityType === 'DECISION',
    );
    if (meetingDecResult) {
      const decision = await decisionRepo.findOne({ where: { id: meetingDecResult.id } });
      if (decision?.sourceMeetingId !== meeting.id) {
        throw new Error('Created decision did not link to source meeting ID');
      }
      console.log(`  ✓ Decision ${decision.id} correctly links to sourceMeetingId: ${meeting.id}`);
    }

    // Verify Requirement links to sourceMeetingId
    const meetingReqResult = meetingConfirmRes.resultRecordIds.find(
      (r: { entityType: string }) => r.entityType === 'REQUIREMENT',
    );
    if (meetingReqResult) {
      const req = await reqRepo.findOne({ where: { id: meetingReqResult.id } });
      if (req?.sourceMeetingId !== meeting.id) {
        throw new Error('Created requirement did not link to source meeting ID');
      }
      console.log(`  ✓ Requirement ${req.id} correctly links to sourceMeetingId: ${meeting.id}`);
    }

    // Verify Meeting summary was updated
    const reloadedMeeting = await meetingRepo.findOne({ where: { id: meeting.id } });
    if (!reloadedMeeting?.summary) {
      throw new Error('Meeting summary was not updated upon proposal confirmation');
    }
    console.log(`  ✓ Meeting approved summary updated in PostgreSQL: "${reloadedMeeting.summary}"`);

    // ── Scenario E: Stale Source Conflict Detection ──
    console.log('\n[Phase 6] Testing Stale Source Detection on Requirement / Meeting Evolution...');
    const proposalForStaleTest = await proposalsService.generateTaskProposal(
      project.id,
      user.id,
      requirement.id,
    );

    // Requirement is edited by another user, incrementing version to 2
    requirement.version = 2;
    requirement.title = 'Updated Requirement Title After Revision';
    await reqRepo.save(requirement);

    let staleConflictCaught = false;
    try {
      await proposalsService.confirmProposal(
        project.id,
        user,
        proposalForStaleTest.id,
        { version: 1 },
        `idem-stale-${Date.now()}`,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        staleConflictCaught = true;
        console.log(
          '  ✓ Stale proposal correctly rejected with 409 STALE_PROPOSAL when requirement version changed',
        );
      }
    }
    if (!staleConflictCaught)
      throw new Error('Failed to reject stale proposal on modified requirement');

    // ── Scenario F: RBAC Enforcement (Viewer Blocked) ──
    console.log('\n[Phase 7] Testing RBAC Enforcement (Viewer Forbidden)...');
    const viewerProposal = await proposalsService.generateTaskProposal(
      project.id,
      user.id,
      requirement.id,
    );

    let viewerForbiddenCaught = false;
    try {
      await proposalsService.confirmProposal(
        project.id,
        viewer,
        viewerProposal.id,
        { version: 1 },
        `idem-viewer-${Date.now()}`,
      );
    } catch (err) {
      if (err instanceof ForbiddenException) {
        viewerForbiddenCaught = true;
        console.log('  ✓ Viewer role correctly blocked with 403 Forbidden on confirmation');
      }
    }
    if (!viewerForbiddenCaught) throw new Error('Viewer was not forbidden');

    console.log('\n========================================================================');
    console.log('  ALL AI TASK GENERATION & REFINEMENT CHECKS PASSED (100% SUCCESS)');
    console.log('========================================================================\n');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
