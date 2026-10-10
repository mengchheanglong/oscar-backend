import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
@Injectable()
export class NativeFolderPickerService {
  private picking = false;
  available(): boolean {
    return process.platform === 'win32';
  }
  async select(signal?: AbortSignal): Promise<string | null> {
    if (!this.available())
      throw new ServiceUnavailableException('Native folder selection requires Windows.');
    if (this.picking) throw new ConflictException('A folder chooser is already open.');
    this.picking = true;
    try {
      const env: NodeJS.ProcessEnv = {};
      for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA'])
        if (process.env[name]) env[name] = process.env[name];
      const executable = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      );
      const { stdout } = await execute(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('scripts/select-local-folder.ps1'),
        ],
        {
          env,
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 16384,
          signal,
        },
      );
      const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as { path: unknown };
      if (result.path === null) return null;
      if (typeof result.path !== 'string' || !result.path || result.path.length > 1000)
        throw new Error('Invalid picker response');
      return result.path;
    } catch {
      throw new ServiceUnavailableException(
        'Folder chooser unavailable or timed out. Try again or enter the path manually.',
      );
    } finally {
      this.picking = false;
    }
  }
}
