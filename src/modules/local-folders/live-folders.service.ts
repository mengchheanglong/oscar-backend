import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { SystemRole } from '../users/entities/user.entity';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectMember } from '../projects/entities/project-member.entity';
import { ProjectStatus } from '../projects/entities/project.entity';
import { PdfExtractor } from '../ingestion/extractors/pdf-extractor';
import { DocxExtractor } from '../ingestion/extractors/docx-extractor';

interface Mount {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  root: string;
}
const execute = promisify(execFile);
@Injectable()
export class LiveFoldersService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
  ) {}
  enabled(): boolean {
    return (
      this.config.get<boolean>('LOCAL_FILES_ENABLED') === true &&
      ['127.0.0.1', 'localhost', '::1'].includes(this.config.get<string>('HOST') || '') &&
      this.config.get<string>('NODE_ENV') !== 'production'
    );
  }
  private registry(): string {
    return path.resolve(
      this.config.get<string>('LOCAL_FILES_REGISTRY') || './var/local-folders.json',
    );
  }
  private async access(
    projectId: string,
    userId: string,
    mutation = false,
  ): Promise<ProjectMember> {
    if (!this.enabled()) throw new ServiceUnavailableException('Local folder access is disabled.');
    const member = await this.database.getRepository(ProjectMember).findOne({
      where: { projectId, userId, removedAt: IsNull() },
      relations: ['project', 'user'],
    });
    if (!member?.project || !member.user?.isActive)
      throw new NotFoundException('Project not found.');
    if (mutation && member.project.status === ProjectStatus.ARCHIVED)
      throw new BadRequestException('This project is read-only.');
    return member;
  }
  private async load(): Promise<Mount[]> {
    try {
      return JSON.parse(await fs.readFile(this.registry(), 'utf8')) as Mount[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ServiceUnavailableException('Local connections unavailable.');
    }
  }
  private mutate<T>(operation: (mounts: Mount[]) => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      const mounts = await this.load();
      const result = await operation(mounts);
      const registry = this.registry();
      await fs.mkdir(path.dirname(registry), { recursive: true });
      const temp = registry + '.' + randomUUID();
      await fs.writeFile(temp, JSON.stringify(mounts), { mode: 0o600 });
      await fs.rename(temp, registry);
      return result;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  async list(projectId: string, userId: string) {
    await this.access(projectId, userId);
    return (await this.load())
      .filter((m) => m.projectId === projectId && m.userId === userId)
      .map((m) => ({ id: m.id, name: m.name, path: m.root }));
  }
  async connect(projectId: string, userId: string, root: string) {
    const member = await this.access(projectId, userId, true);
    if (member.user!.systemRole !== SystemRole.ADMIN)
      throw new ForbiddenException('Only the local administrator can connect filesystem folders.');
    if (!path.isAbsolute(root) || root.startsWith('\\\\') || root.startsWith('//'))
      throw new BadRequestException('Enter an absolute local directory path.');
    let canonical: string;
    try {
      canonical = await fs.realpath(root);
      if (!(await fs.stat(canonical)).isDirectory() || path.parse(canonical).root === canonical)
        throw new Error();
    } catch {
      throw new BadRequestException('Choose an existing folder, not a drive root.');
    }
    return this.mutate(async (mounts) => {
      const prior = mounts.find(
        (m) => m.projectId === projectId && m.userId === userId && m.root === canonical,
      );
      if (prior) return { id: prior.id, name: prior.name, path: prior.root };
      const mount = {
        id: randomUUID(),
        projectId,
        userId,
        root: canonical,
        name: path.basename(canonical),
      };
      mounts.push(mount);
      return { id: mount.id, name: mount.name, path: mount.root };
    });
  }
  async disconnect(projectId: string, userId: string, id: string): Promise<void> {
    await this.access(projectId, userId, true);
    await this.mutate(async (mounts) => {
      const i = mounts.findIndex(
        (m) => m.id === id && m.projectId === projectId && m.userId === userId,
      );
      if (i < 0) throw new NotFoundException('Folder not found.');
      mounts.splice(i, 1);
    });
  }
  private async mount(projectId: string, userId: string, id: string): Promise<Mount> {
    await this.access(projectId, userId);
    const mount = (await this.load()).find(
      (m) => m.id === id && m.projectId === projectId && m.userId === userId,
    );
    if (!mount) throw new NotFoundException('Folder not found.');
    try {
      if ((await fs.realpath(mount.root)) !== mount.root) throw new Error();
    } catch {
      throw new BadRequestException('Connected folder is unavailable or changed.');
    }
    return mount;
  }
  private async file(mount: Mount, relative: string): Promise<string> {
    if (
      !relative ||
      relative.length > 1000 ||
      relative.includes('\\') ||
      relative.includes(':') ||
      relative.split('/').some((p) => !p || p === '..' || p === '.') ||
      path.isAbsolute(relative)
    )
      throw new BadRequestException('Use a relative file path.');
    const resolved = path.resolve(mount.root, relative);
    if (!resolved.startsWith(mount.root + path.sep))
      throw new BadRequestException('File is outside the folder.');
    let current = mount.root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new BadRequestException('Linked files are not accessible.');
    }
    if ((await fs.realpath(resolved)) !== resolved)
      throw new BadRequestException('File is outside the folder.');
    return resolved;
  }
  private async rg(mount: Mount, args: string[]): Promise<string> {
    try {
      return (
        await execute(
          'rg',
          [
            ...args,
            '--hidden',
            '--glob',
            '!**/.git/**',
            '--glob',
            '!**/node_modules/**',
            '--glob',
            '!**/vendor/**',
            '--glob',
            '!**/dist/**',
            '--glob',
            '!**/build/**',
            '--glob',
            '!**/coverage/**',
            '--glob',
            '!**/.env*',
            '--glob',
            '!**/*credentials*',
            '--glob',
            '!**/*.pem',
          ],
          { cwd: mount.root, timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        )
      ).stdout;
    } catch (error) {
      if ((error as { code?: number }).code === 1) return '';
      throw new BadRequestException(
        'Search unavailable or too broad. Narrow the search; ripgrep must be installed.',
      );
    }
  }
  async files(projectId: string, userId: string, id: string, query = '', offset = 0) {
    const mount = await this.mount(projectId, userId, id);
    const output = await this.rg(mount, ['--files']);
    await this.mount(projectId, userId, id);
    const files = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
      .sort();
    return {
      folderId: id,
      files: files.slice(offset, offset + 100),
      nextOffset: files.length > offset + 100 ? offset + 100 : null,
    };
  }
  async search(projectId: string, userId: string, id: string, query: string, offset = 0) {
    const mount = await this.mount(projectId, userId, id);
    // Pattern is passed as a separate argument, never through a shell.
    const output = await this.rg(mount, [
      '--json',
      '--fixed-strings',
      '--max-count',
      '2',
      '-e',
      query,
      '.',
    ]);
    const matches = [];
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      const item = JSON.parse(line);
      if (item.type !== 'match') continue;
      const relative = item.data.path.text.replace(/\\/g, '/').replace(/^\.\//, '');
      await this.file(mount, relative);
      matches.push({
        path: relative,
        line: item.data.line_number,
        text: item.data.lines.text.slice(0, 500),
      });
    }
    await this.mount(projectId, userId, id);
    return {
      folderId: id,
      matches: matches.slice(offset, offset + 50),
      nextOffset: matches.length > offset + 50 ? offset + 50 : null,
    };
  }
  async read(projectId: string, userId: string, id: string, relative: string, offset = 0) {
    const mount = await this.mount(projectId, userId, id);
    let file: string;
    try {
      file = await this.file(mount, relative);
    } catch {
      throw new BadRequestException('File not accessible within the connected folder.');
    }
    const before = await fs.stat(file);
    if (!before.isFile()) throw new BadRequestException('Choose a file.');
    const metadata = {
      folderId: id,
      path: relative,
      size: before.size,
      modifiedAt: before.mtime.toISOString(),
    };
    if (before.size > 10 * 1024 * 1024)
      return { ...metadata, text: null, reason: 'File exceeds the 10 MiB per-read limit.' };
    const handle = await fs.open(file, 'r');
    let buffer: Buffer;
    try {
      const opened = await handle.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('FILE_CHANGED');
      buffer = await handle.readFile();
    } finally {
      await handle.close();
    }
    await this.mount(projectId, userId, id);
    await this.file(mount, relative);
    const after = await fs.stat(file);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size)
      throw new BadRequestException('File changed during reading. Retry.');
    let text: string;
    if (relative.toLowerCase().endsWith('.pdf'))
      text = (await new PdfExtractor().extract(buffer, 'application/pdf', relative)).text;
    else if (relative.toLowerCase().endsWith('.docx'))
      text = (await new DocxExtractor().extract(buffer, 'application/octet-stream', relative)).text;
    else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        if (text.includes('\0')) throw new Error();
      } catch {
        return {
          ...metadata,
          text: null,
          reason: 'Binary content requires a format-specific reader.',
        };
      }
    }
    if (text.length > 4 * 1024 * 1024)
      throw new BadRequestException('Extracted text exceeds the processing limit.');
    const hash = createHash('sha256').update(buffer).digest('hex');
    return {
      ...metadata,
      hash,
      text: text.slice(offset, offset + 8000),
      offset,
      nextOffset: text.length > offset + 8000 ? offset + 8000 : null,
      citation: `local:${id}:${relative}#${hash.slice(0, 12)}:${offset}`,
    };
  }
}
