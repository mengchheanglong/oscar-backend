import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { AssistantProposal } from './proposal.entity';

@Entity('proposal_commits')
@Index('idx_proposal_commits_actor_proj_idem', ['actorId', 'projectId', 'idempotencyKey'], {
  unique: true,
})
export class ProposalCommit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'proposal_id', type: 'uuid', unique: true })
  proposalId!: string;

  @OneToOne(() => AssistantProposal, (proposal) => proposal.commit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'proposal_id' })
  proposal?: AssistantProposal;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor?: User;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Column({ name: 'result_record_ids', type: 'jsonb', default: () => "'[]'" })
  resultRecordIds!: Array<{ entityType: string; id: string; key?: string }>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
