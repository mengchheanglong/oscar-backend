import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('chief_preferences')
export class ChiefPreferences {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar', length: 10, default: 'OFF' }) cadence!: 'OFF' | 'DAILY' | 'WEEKLY';
  @Column({ name: 'hour_utc', type: 'integer', default: 2 }) hourUtc!: number;
  @Column({ name: 'monthly_budget_usd', type: 'numeric', precision: 12, scale: 4, nullable: true })
  monthlyBudgetUsd!: string | null;
  @Column({ name: 'next_briefing_at', type: 'timestamptz', nullable: true })
  nextBriefingAt!: Date | null;
  @Column({ name: 'last_briefing_at', type: 'timestamptz', nullable: true })
  lastBriefingAt!: Date | null;
}
