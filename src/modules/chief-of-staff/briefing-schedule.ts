export function nextBriefing(
  now: Date,
  cadence: 'OFF' | 'DAILY' | 'WEEKLY',
  hourUtc: number,
): Date | null {
  if (cadence === 'OFF') return null;
  const date = new Date(now);
  date.setUTCHours(hourUtc, 0, 0, 0);
  if (cadence === 'WEEKLY') date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7));
  if (date <= now) date.setUTCDate(date.getUTCDate() + (cadence === 'DAILY' ? 1 : 7));
  return date;
}
