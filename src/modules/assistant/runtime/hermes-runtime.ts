import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentRuntime, RuntimeCallbacks, RuntimeInput, WORKSPACE_TOOLS } from './runtime-contract';
import { hermesEnvironment, nousCredentials } from './hermes-credentials';

@Injectable()
export class HermesRuntime implements AgentRuntime {
  constructor(private readonly config: ConfigService) {}

  available(): boolean {
    const python = this.config.get<string>('HERMES_PYTHON');
    const root = this.config.get<string>('HERMES_ROOT');
    return Boolean(
      this.config.get<boolean>('HERMES_ENABLED') &&
      this.config.get<boolean>('AI_ENABLED') &&
      python &&
      isAbsolute(python) &&
      existsSync(python) &&
      root &&
      isAbsolute(root) &&
      existsSync(resolve(root, 'run_agent.py')) &&
      (this.config.get<string>('HERMES_PROVIDER') === 'nous'
        ? ['HERMES_AUTH_PYTHON', 'HERMES_AUTH_ROOT', 'HERMES_AUTH_HOME'].every((name) => {
            const value = this.config.get<string>(name);
            return value && isAbsolute(value) && existsSync(value);
          })
        : this.config.get<string>('DEEPSEEK_API_KEY')),
    );
  }

  execute(input: RuntimeInput, callbacks: RuntimeCallbacks, signal: AbortSignal): Promise<string> {
    if (!this.available() || signal.aborted) return Promise.reject(new Error('HERMES_UNAVAILABLE'));
    if (this.config.get<string>('HERMES_PROVIDER') === 'nous')
      return nousCredentials(this.config, input.model, signal).then((credentials) =>
        this.run({ ...input, ...credentials }, callbacks, signal),
      );
    return this.run(
      { ...input, provider: 'deepseek', baseUrl: 'https://api.deepseek.com' },
      callbacks,
      signal,
    );
  }

  private run(
    input: RuntimeInput & { provider: string; baseUrl: string },
    callbacks: RuntimeCallbacks,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) return Promise.reject(new Error('HERMES_CANCELLED'));
    return new Promise((resolveResult, reject) => {
      // A minimal child environment prevents inherited PATs, other model keys and personal profiles.
      const env: NodeJS.ProcessEnv = {
        AIW_HERMES_ROOT: this.config.get<string>('HERMES_ROOT'),
        ...hermesEnvironment(),
      };
      const child = spawn(
        this.config.get<string>('HERMES_PYTHON')!,
        [resolve('scripts/hermes/bridge.py')],
        { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let buffer = '';
      let bytes = 0;
      let result: string | undefined;
      let ended = false;
      let chain = Promise.resolve();
      let calls = 0;
      const finish = (error?: Error) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        child.kill();
        if (error) reject(error);
        else if (result) resolveResult(result);
        else reject(new Error('HERMES_PROTOCOL_FAILED'));
      };
      const abort = () => finish(new Error('HERMES_CANCELLED'));
      const timer = setTimeout(() => finish(new Error('HERMES_TIMEOUT')), 180000);
      signal.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(new Error('HERMES_START_FAILED')));
      child.stdin.on('error', () => finish(new Error('HERMES_PROTOCOL_FAILED')));
      // Never forward subprocess diagnostics or provider payloads to application logs.
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        buffer += chunk.toString('utf8');
        if (bytes > 262144 || buffer.length > 65536)
          return finish(new Error('HERMES_OUTPUT_LIMIT'));
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          chain = chain
            .then(async () => {
              if (ended || signal.aborted) return;
              const event: unknown = JSON.parse(line);
              if (!event || typeof event !== 'object') throw new Error('HERMES_PROTOCOL_FAILED');
              const e = event as Record<string, unknown>;
              if (
                e.type === 'tool' &&
                typeof e.id === 'string' &&
                typeof e.name === 'string' &&
                !result &&
                ++calls <= 12
              ) {
                const value = await callbacks.tool(e.name, e.args);
                if (!ended) child.stdin.write(JSON.stringify({ id: e.id, result: value }) + '\n');
              } else if (
                e.type === 'result' &&
                typeof e.content === 'string' &&
                e.content.trim() &&
                e.content.length <= 24000 &&
                !result
              ) {
                result = e.content;
              } else throw new Error('HERMES_PROTOCOL_FAILED');
            })
            .catch(() => finish(new Error('HERMES_EXECUTION_FAILED')));
        }
      });
      child.on('close', (code) => {
        void chain.then(() =>
          finish(code === 0 ? undefined : new Error('HERMES_EXECUTION_FAILED')),
        );
      });
      child.stdin.write(JSON.stringify({ ...input, tools: WORKSPACE_TOOLS }) + '\n');
    });
  }
}
