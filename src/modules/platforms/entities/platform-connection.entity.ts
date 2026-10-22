import { credentialTransformer } from '../credential-vault';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Project } from '../../projects/entities/project.entity';
import { ExternalLink } from './external-link.entity';

export enum PlatformType {
  PAPERCLIP = 'paperclip',
  T3 = 't3',
}

export enum PlatformConnectionStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  REVOKED = 'REVOKED',
  UNREACHABLE = 'UNREACHABLE',
  DISCONNECTED = 'DISCONNECTED',
}

export enum PlatformAuthType {
  BEARER = 'bearer',
  API_KEY = 'api_key',
  NONE = 'none',
  OAUTH = 'oauth',
}

export interface PlatformVersionInfo {
  apiVersion?: string;
  platformVersion?: string;
  versionDrift?: boolean;
  minSupportedVersion?: string;
  detectedAt?: string;
}

@Entity('platform_connections')
export class PlatformConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index()
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id' })
  project!: Project | null;

  @Index()
  @Column({ name: 'platform_type', type: 'varchar', length: 30 })
  platformType!: PlatformType;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'base_url', type: 'varchar', length: 500 })
  baseUrl!: string;

  @Column({ name: 'auth_type', type: 'varchar', length: 30, default: PlatformAuthType.BEARER })
  authType!: PlatformAuthType;

  @Column({
    name: 'auth_token',
    type: 'text',
    nullable: true,
    select: true,
    transformer: credentialTransformer,
  })
  authToken!: string | null;

  @Index()
  @Column({
    type: 'varchar',
    length: 30,
    default: PlatformConnectionStatus.HEALTHY,
  })
  status!: PlatformConnectionStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  capabilities!: string[];

  @Column({ name: 'version_info', type: 'jsonb', default: () => "'{}'::jsonb" })
  versionInfo!: PlatformVersionInfo;

  @Column({ name: 'last_health_check_at', type: 'timestamptz', nullable: true })
  lastHealthCheckAt!: Date | null;

  @Column({ name: 'health_error', type: 'text', nullable: true })
  healthError!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @OneToMany(() => ExternalLink, (link) => link.connection)
  externalLinks!: ExternalLink[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
