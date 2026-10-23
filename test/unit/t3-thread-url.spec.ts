import { t3ThreadUrl } from '../../src/modules/platforms/t3-thread-url';
import { PlatformHandoffResponseDto } from '../../src/modules/assistant/dto/platform-handoff-response.dto';
import type { PlatformHandoff } from '../../src/modules/assistant/entities/platform-handoff.entity';
import { T3Adapter } from '../../src/modules/platforms/adapters/t3.adapter';

describe('T3 connected-server navigation', () => {
  afterEach(() => jest.restoreAllMocks());
  it('uses the server environment, preserving MCP thread IDs as a single route segment', () => {
    expect(t3ThreadUrl('http://127.0.0.1:43102/', 'project-1', 'mcp:thread-1')).toBe(
      'http://127.0.0.1:43102/project-1/mcp%3Athread-1',
    );
    expect(t3ThreadUrl('https://t3.example.test/', 'project-2', 'thread-2')).toBe(
      'https://t3.example.test/project-2/thread-2',
    );
  });
  it('never embeds credentials or accepts executable origins and escaping route segments', () => {
    expect(t3ThreadUrl('http://user:secret@localhost:43102', 'p', 't')).toBeNull();
    expect(t3ThreadUrl('javascript:alert(1)', 'p', 't')).toBeNull();
    expect(t3ThreadUrl('http://localhost:43102', '..', 't')).toBeNull();
    expect(t3ThreadUrl('http://localhost:43102', 'p', 't\n')).toBeNull();
    expect(t3ThreadUrl('http://localhost:43102', 'p', null)).toBeNull();
  });
  it('opens the server home when its environment is unavailable rather than starting desktop', () => {
    expect(t3ThreadUrl('http://localhost:43102?token=not-forwarded', null, 'thread')).toBe(
      'http://localhost:43102/',
    );
  });
  it('repairs navigation for existing T3 rows without changing the record or Paperclip URLs', () => {
    const row = {
      platformType: 't3',
      connectionOrigin: 'http://localhost:43102',
      remoteProjectId: 'p',
      threadId: 'mcp:t',
      externalUrl: null,
      status: 'WAITING',
    } as PlatformHandoff;
    expect(
      PlatformHandoffResponseDto.fromEntity(
        row,
        t3ThreadUrl(row.connectionOrigin, 'p', row.threadId),
      ),
    ).toMatchObject({
      status: 'WAITING',
      externalUrl: 'http://localhost:43102/p/mcp%3At',
    });
    expect(row.externalUrl).toBeNull();
    expect(
      PlatformHandoffResponseDto.fromEntity({
        ...row,
        platformType: 'paperclip',
        externalUrl: 'http://localhost:43103/issues/DEMO-1',
      }).externalUrl,
    ).toBe('http://localhost:43103/issues/DEMO-1');
  });
  it('discovers the environment route once per server and shares concurrent lookups', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ environmentId: 'environment-1' })));
    const adapter = new T3Adapter(null!);
    const links = await Promise.all([
      adapter.threadUrl('http://localhost:43102', 'mcp:t'),
      adapter.threadUrl('http://localhost:43102', 'thread-2'),
    ]);
    expect(links).toEqual([
      'http://localhost:43102/environment-1/mcp%3At',
      'http://localhost:43102/environment-1/thread-2',
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
    expect(request.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
  it('keeps navigation usable when discovery is offline', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await new T3Adapter(null!).threadUrl('http://localhost:43102', 'thread')).toBe(
      'http://localhost:43102/',
    );
  });
});
