export function mockVerificationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.TEST_DATABASE_URL;
  let url: URL | undefined;
  try {
    url = value ? new URL(value) : undefined;
  } catch {
    // Never include a connection string or its credentials in an error.
  }
  if (
    !value ||
    !url ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.port !== '43105' ||
    url.pathname !== '/ai_workspace_test' ||
    value === env.DATABASE_URL
  ) {
    throw new Error(
      'Mock verification requires a separate local TEST_DATABASE_URL on port 43105 for ai_workspace_test.',
    );
  }
  return value;
}
