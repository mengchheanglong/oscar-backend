import { PaperclipAdapter } from '../../src/modules/platforms/adapters/paperclip.adapter';
import { PlatformConnection } from '../../src/modules/platforms/entities/platform-connection.entity';

describe('Paperclip assigned issue execution contract', () => {
  const adapter = new PaperclipAdapter();
  const connection = {
    baseUrl: 'http://localhost:43103',
    authToken: 'synthetic-token',
    metadata: { companyId: 'company', paperclipAccess: 'supervised' },
  } as unknown as PlatformConnection;
  const issue = {
    id: 'issue',
    companyId: 'company',
    assigneeAgentId: 'agent',
    status: 'in_progress',
  };
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it('requires execution opt-in before creating issues', async () => {
    await expect(
      adapter.launch(
        { ...connection, metadata: { companyId: 'company' } },
        'key',
        'Task',
        'Work',
        'agent',
      ),
    ).rejects.toThrow('Enable Paperclip');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('assigns the exact reviewed task with a stable remote idempotency key', async () => {
    fetchMock.mockResolvedValue(reply(issue));
    await adapter.launch(connection, 'retry-key', 'Task', 'Reviewed task', 'agent', 'project');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:43103/api/companies/company/issues');
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer synthetic-token');
    expect(body).toMatchObject({
      status: 'todo',
      assigneeAgentId: 'agent',
      projectId: 'project',
      idempotencyKey: 'oscar:retry-key',
    });
    expect(body.description).toContain('Reviewed task');
  });
  it('reads only the final scoped agent reply, not a user comment or another task', async () => {
    fetchMock.mockResolvedValueOnce(reply(issue)).mockResolvedValueOnce(
      reply([
        {
          companyId: 'company',
          issueId: 'issue',
          authorAgentId: 'agent',
          body: 'Early note',
          createdAt: '2026-10-18',
        },
        {
          companyId: 'company',
          issueId: 'issue',
          authorAgentId: 'agent',
          body: 'Final result',
          createdAt: '2026-10-19',
        },
        {
          companyId: 'company',
          issueId: 'issue',
          authorUserId: 'user',
          body: 'Wrong human result',
          createdAt: '2026-10-20',
        },
        {
          companyId: 'other',
          issueId: 'issue',
          authorAgentId: 'agent',
          body: 'Wrong company',
          createdAt: '2026-10-21',
        },
      ]),
    );
    expect(await adapter.resultComments(connection, 'issue', 'company', 'agent')).toBe(
      'Final result',
    );
  });
  it('rejects foreign company records and unrelated run cancellation', async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...issue, companyId: 'other' }));
    await expect(adapter.readIssue(connection, 'issue', 'company')).rejects.toThrow(
      'scope changed',
    );
    fetchMock
      .mockResolvedValueOnce(reply({ ...issue, executionRunId: 'run' }))
      .mockResolvedValueOnce(
        reply({
          companyId: 'company',
          agentId: 'agent',
          status: 'running',
          contextSnapshot: { issueId: 'other' },
        }),
      );
    await expect(
      adapter.cancelIssue(connection, 'issue', 'company', 'agent', 'request'),
    ).rejects.toThrow('verify');
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('cancels a verified active run before cancelling its issue', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ ...issue, executionRunId: 'run' }))
      .mockResolvedValueOnce(
        reply({
          companyId: 'company',
          agentId: 'agent',
          status: 'running',
          contextSnapshot: { issueId: 'issue' },
        }),
      )
      .mockResolvedValueOnce(reply({ status: 'cancelled' }))
      .mockResolvedValueOnce(reply({ ...issue, status: 'cancelled' }));
    await adapter.cancelIssue(connection, 'issue', 'company', 'agent', 'request');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
      'GET',
      'GET',
      'POST',
      'PATCH',
    ]);
  });
  it('does not turn already completed work into cancelled work', async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...issue, status: 'done' }));
    await adapter.cancelIssue(connection, 'issue', 'company', 'agent', 'request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports missing board authority without falsely cancelling the issue', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ ...issue, executionRunId: 'run' }))
      .mockResolvedValueOnce(
        reply({
          companyId: 'company',
          agentId: 'agent',
          status: 'running',
          contextSnapshot: { issueId: 'issue' },
        }),
      )
      .mockResolvedValueOnce(reply({ error: 'denied' }, 403));
    await expect(
      adapter.cancelIssue(connection, 'issue', 'company', 'agent', 'request'),
    ).rejects.toThrow('board authorization');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'POST']);
  });
});
