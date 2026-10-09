import { ConfigService } from '@nestjs/config';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { HermesRuntime } from '../../src/modules/ai/runtime/hermes-runtime';

describe('Hermes subprocess boundary', () => {
  function setup() {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    });
    const spawn = jest
      .spyOn(childProcess, 'spawn')
      .mockReturnValue(child as unknown as childProcess.ChildProcess);
    const runtime = new HermesRuntime(
      new ConfigService({
        AI_ENABLED: true,
        HERMES_ENABLED: true,
        HERMES_PYTHON: path.resolve('prepared-python'),
        HERMES_ROOT: path.resolve('isolated-source'),
        DEEPSEEK_API_KEY: 'synthetic-test-key',
      }),
    );
    return { child, spawn, runtime };
  }
  const input = {
    prompt: 'Synthetic',
    context: 'Synthetic context',
    model: 'deepseek-v4-pro',
    apiKey: 'synthetic-test-key',
  };

  it('routes tool requests through the parent and completes only on a clean process exit', async () => {
    const { child, spawn, runtime } = setup();
    const tool = jest.fn().mockResolvedValue({ operatingProfit: 50 });
    const promise = runtime.execute(input, { tool }, new AbortController().signal);
    child.stdout.write(
      JSON.stringify({ type: 'tool', id: '1', name: 'calculate_pricing', args: { units: 10 } }) +
        '\n',
    );
    await new Promise((r) => setImmediate(r));
    expect(tool).toHaveBeenCalledWith('calculate_pricing', { units: 10 });
    child.stdout.write(JSON.stringify({ type: 'result', content: '# Artifact' }) + '\n');
    child.emit('close', 0);
    await expect(promise).resolves.toBe('# Artifact');
    const options = spawn.mock.calls[0]?.[2];
    expect(options).toMatchObject({ windowsHide: true });
    expect(options?.env).not.toHaveProperty('AI_WORKSPACE_API_KEY');
    expect(options?.env).not.toHaveProperty('DEEPSEEK_API_KEY');
  });

  it('kills the owned subprocess on cancellation and rejects late output', async () => {
    const { child, runtime } = setup();
    const controller = new AbortController();
    const promise = runtime.execute(input, { tool: jest.fn() }, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('HERMES_CANCELLED');
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects malformed output without exposing raw child diagnostics', async () => {
    const { child, runtime } = setup();
    const promise = runtime.execute(input, { tool: jest.fn() }, new AbortController().signal);
    child.stderr.write('synthetic private diagnostic');
    child.stdout.write('not-json\n');
    await expect(promise).rejects.toThrow('HERMES_EXECUTION_FAILED');
  });

  it('discards artifacts from failed subprocess exits', async () => {
    const { child, runtime } = setup();
    const promise = runtime.execute(input, { tool: jest.fn() }, new AbortController().signal);
    child.stdout.write(JSON.stringify({ type: 'result', content: 'Partial artifact' }) + '\n');
    child.emit('close', 1);
    await expect(promise).rejects.toThrow('HERMES_EXECUTION_FAILED');
  });
});
