import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

/** Exact origin allowlist also covers local installations. Redirects never carry credentials elsewhere. */
export function platformUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Enter a valid platform URL.');
  }
  const defaults =
    'http://localhost:43103,http://127.0.0.1:43103,http://localhost:43102,http://127.0.0.1:43102';
  const allowed = (process.env.PLATFORM_ALLOWED_ORIGINS ?? defaults)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowed.includes(url.origin)
  ) {
    throw new BadRequestException(
      'Platform origin must be listed in PLATFORM_ALLOWED_ORIGINS; credentials, query strings and fragments are not allowed.',
    );
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new BadRequestException('Remote platforms require HTTPS.');
  return url;
}
export async function platformFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const value = input instanceof Request ? input.url : String(input);
  // Connection URLs remain query-free. Outbound adapter requests may use
  // pagination/filter parameters while retaining the same origin checks.
  const target = new URL(value);
  target.search = '';
  platformUrl(target.toString());
  return fetch(input, {
    ...init,
    redirect: 'error',
    signal: init?.signal ?? AbortSignal.timeout(8000),
  });
}
export class PlatformReadError extends ServiceUnavailableException {
  constructor(
    readonly remoteStatus: number,
    message: string,
  ) {
    super(message);
  }
}
export async function platformJson(url: string, token: string | null): Promise<unknown> {
  const response = await platformFetch(url, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok)
    throw new PlatformReadError(response.status, `Platform read failed (HTTP ${response.status}).`);
  return response.json();
}
export function records(value: unknown, key: string): Record<string, unknown>[] {
  const body = value as Record<string, unknown> | null;
  const rows = Array.isArray(value) ? value : (body?.[key] ?? body?.items);
  if (!Array.isArray(rows))
    throw new PlatformReadError(
      502,
      'Platform response shape changed. Reconnect after checking the supported contract.',
    );
  return rows.filter(
    (row): row is Record<string, unknown> =>
      !!row && typeof row === 'object' && !Array.isArray(row),
  );
}
