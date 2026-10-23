import { mockVerificationDatabaseUrl } from '../../scripts/mock-verification-database';

const testUrl = 'postgresql://test:test@127.0.0.1:43105/ai_workspace_test';

describe('mock verification database isolation', () => {
  it('uses the explicitly configured isolated database', () => {
    expect(mockVerificationDatabaseUrl({ TEST_DATABASE_URL: testUrl })).toBe(testUrl);
  });
  it.each([
    {},
    { DATABASE_URL: testUrl },
    { TEST_DATABASE_URL: testUrl, DATABASE_URL: testUrl },
    { TEST_DATABASE_URL: testUrl.replace('43105', '43104') },
    { TEST_DATABASE_URL: testUrl.replace('127.0.0.1', 'remote.example.com') },
    { TEST_DATABASE_URL: testUrl.replace('ai_workspace_test', 'ai_workspace') },
  ])('rejects missing or non-isolated configuration without printing credentials', (env) => {
    expect(() => mockVerificationDatabaseUrl(env)).toThrow(
      /^Mock verification requires a separate local TEST_DATABASE_URL/,
    );
  });
});
