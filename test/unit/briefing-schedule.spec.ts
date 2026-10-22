import { nextBriefing } from '../../src/modules/chief-of-staff/briefing-schedule';

describe('Opt-in briefing scheduling in UTC', () => {
  it('does not schedule disabled briefings', () =>
    expect(nextBriefing(new Date(), 'OFF', 2)).toBeNull());
  it('schedules the next daily hour without replaying missed days', () => {
    expect(nextBriefing(new Date('2026-10-22T03:00:00Z'), 'DAILY', 2)?.toISOString()).toBe(
      '2026-10-23T02:00:00.000Z',
    );
    expect(nextBriefing(new Date('2026-10-22T01:00:00Z'), 'DAILY', 2)?.toISOString()).toBe(
      '2026-10-22T02:00:00.000Z',
    );
  });
  it('schedules Mondays and advances exactly-at-due requests', () => {
    expect(nextBriefing(new Date('2026-10-22T01:00:00Z'), 'WEEKLY', 2)?.toISOString()).toBe(
      '2026-10-26T02:00:00.000Z',
    );
    expect(nextBriefing(new Date('2026-10-26T02:00:00Z'), 'WEEKLY', 2)?.toISOString()).toBe(
      '2026-11-02T02:00:00.000Z',
    );
    expect(nextBriefing(new Date('2026-10-25T03:00:00Z'), 'WEEKLY', 2)?.toISOString()).toBe(
      '2026-10-26T02:00:00.000Z',
    );
  });
});
