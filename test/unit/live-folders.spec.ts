import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { LiveFoldersService } from '../../src/modules/local-folders/live-folders.service';
import { SystemRole } from '../../src/modules/users/entities/user.entity';
import { NativeFolderPickerService } from '../../src/modules/local-folders/native-folder-picker.service';

describe('Local filesystem capability boundaries', () => {
  let temp: string,
    root: string,
    outside: string,
    service: LiveFoldersService,
    config: ConfigService;
  const membership = jest.fn();
  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aiw-live-test-'));
    root = path.join(temp, 'project');
    outside = path.join(temp, 'outside');
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'Outside confidential data');
    membership.mockResolvedValue({
      project: { status: 'ACTIVE' },
      user: { isActive: true, systemRole: SystemRole.ADMIN },
    });
    config = new ConfigService({
      LOCAL_FILES_ENABLED: true,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      LOCAL_FILES_REGISTRY: path.join(temp, 'registry.json'),
    });
    service = new LiveFoldersService(
      { getRepository: () => ({ findOne: membership }) } as unknown as DataSource,
      config,
    );
  });
  afterEach(async () => {
    if (temp && temp.startsWith(os.tmpdir() + path.sep))
      await fs.rm(temp, { recursive: true, force: true });
  });
  it('connects privately and serializes simultaneous connections without duplicates', async () => {
    const result = await Promise.all([
      service.connect('p', 'a', root),
      service.connect('p', 'a', root),
    ]);
    expect(result[0]!.id).toBe(result[1]!.id);
    expect(await service.list('p', 'b')).toEqual([]);
    await expect(service.read('p', 'b', result[0]!.id, 'notes.txt')).rejects.toThrow(
      'Folder not found',
    );
    await expect(service.disconnect('q', 'a', result[0]!.id)).rejects.toThrow();
  });
  it('reads large files in pages and reflects edits without indexing', async () => {
    await fs.writeFile(path.join(root, 'notes.txt'), 'A'.repeat(18000));
    const mount = await service.connect('p', 'a', root);
    const first = await service.read('p', 'a', mount.id, 'notes.txt');
    expect(first.text?.length).toBe(8000);
    expect(first).toMatchObject({ nextOffset: 8000 });
    const next = await service.read('p', 'a', mount.id, 'notes.txt', 8000);
    expect(next.text?.length).toBe(8000);
    await fs.writeFile(path.join(root, 'notes.txt'), 'Updated facts');
    const changed = await service.read('p', 'a', mount.id, 'notes.txt');
    expect(changed.text).toBe('Updated facts');
    expect('hash' in changed && changed.hash).not.toBe('hash' in first && first.hash);
    await service.disconnect('p', 'a', mount.id);
    await expect(service.read('p', 'a', mount.id, 'notes.txt')).rejects.toThrow();
    expect(await fs.readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('Updated facts');
  });
  it('rejects traversal, absolute paths and directory junction escapes', async () => {
    const mount = await service.connect('p', 'a', root);
    await fs.symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    for (const entry of [
      '../outside/private.txt',
      path.join(outside, 'private.txt'),
      'escape/private.txt',
      'a/../private.txt',
    ])
      await expect(service.read('p', 'a', mount.id, entry)).rejects.toThrow();
  });
  it('connects a native selection, ignores cancellation and checks access before and after choosing', async () => {
    const select = jest.fn().mockResolvedValue(null);
    const picker = { select } as unknown as NativeFolderPickerService;
    expect(await service.pick('p', 'a', picker)).toEqual({ folder: null });
    expect(await service.list('p', 'a')).toEqual([]);
    select.mockResolvedValue(root);
    expect((await service.pick('p', 'a', picker)).folder).toMatchObject({ path: root });
    membership.mockResolvedValue(null);
    select.mockClear();
    await expect(service.pick('p', 'a', picker)).rejects.toThrow();
    expect(select).not.toHaveBeenCalled();
    membership.mockResolvedValue({
      project: { status: 'ACTIVE' },
      user: { isActive: true, systemRole: SystemRole.ADMIN },
    });
    select.mockImplementation(async () => {
      membership.mockResolvedValue(null);
      return root;
    });
    await expect(service.pick('p', 'a', picker)).rejects.toThrow();
  });
  it('lists more than 100 files with pagination and searches live content', async () => {
    await Promise.all(
      Array.from({ length: 205 }, (_, i) =>
        fs.writeFile(path.join(root, `note-${i}.txt`), i === 204 ? 'Mercury pricing' : 'Other'),
      ),
    );
    const mount = await service.connect('p', 'a', root);
    const files = await service.files('p', 'a', mount.id);
    expect(files.files).toHaveLength(100);
    expect(files.nextOffset).toBe(100);
    expect((await service.files('p', 'a', mount.id, '', 200)).files).toHaveLength(5);
    expect((await service.search('p', 'a', mount.id, 'Mercury')).matches[0]).toMatchObject({
      path: 'note-204.txt',
      text: 'Mercury pricing',
    });
  });
  it('returns binary metadata and extracts DOCX content on demand', async () => {
    await fs.writeFile(path.join(root, 'photo.png'), Buffer.from([0, 1, 2]));
    await fs.copyFile(
      path.join(__dirname, '../fixtures/local-folder.docx'),
      path.join(root, 'report.docx'),
    );
    const mount = await service.connect('p', 'a', root);
    expect(await service.read('p', 'a', mount.id, 'photo.png')).toMatchObject({ text: null });
    expect((await service.read('p', 'a', mount.id, 'report.docx')).text).toContain(
      'Venus DOCX evidence',
    );
  });
  it('rejects disabled, production, non-loopback, non-admin and revoked access', async () => {
    config.set('LOCAL_FILES_ENABLED', false);
    await expect(service.connect('p', 'a', root)).rejects.toThrow();
    config.set('LOCAL_FILES_ENABLED', true);
    config.set('NODE_ENV', 'production');
    expect(service.enabled()).toBe(false);
    config.set('NODE_ENV', 'test');
    config.set('HOST', '0.0.0.0');
    expect(service.enabled()).toBe(false);
    config.set('HOST', '127.0.0.1');
    membership.mockResolvedValue({
      project: { status: 'ACTIVE' },
      user: { isActive: true, systemRole: SystemRole.USER },
    });
    await expect(service.connect('p', 'a', root)).rejects.toThrow('administrator');
    membership.mockResolvedValue(null);
    await expect(service.list('p', 'a')).rejects.toThrow('Project not found');
  });
});
