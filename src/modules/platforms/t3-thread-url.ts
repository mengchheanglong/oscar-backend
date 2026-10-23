/** Open the connected server, never a second desktop server using the same home. */
export function t3ThreadUrl(
  baseUrl: string,
  environmentId: string | null,
  threadId: string | null,
): string | null {
  if (!threadId) return null;
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null;
    if (!environmentId) return base.origin + '/';
    if (
      [environmentId, threadId].some((part) => part === '.' || part === '..' || /[\r\n]/.test(part))
    )
      return null;
    return new URL(
      `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`,
      base.origin,
    ).href;
  } catch {
    return null;
  }
}
