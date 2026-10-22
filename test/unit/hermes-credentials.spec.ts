import { ConfigService } from '@nestjs/config';
import childProcess from 'node:child_process';
import { PassThrough } from 'node:stream';
import { nousCredentials } from '../../src/modules/assistant/runtime/hermes-credentials';

describe('Nous credential broker boundary', () => {
  const model = 'stepfun/step-3.7-flash:free';
  const config = new ConfigService({
    HERMES_AUTH_PYTHON: '/prepared/python',
    HERMES_AUTH_ROOT: '/auth/source',
    HERMES_AUTH_HOME: '/auth/home',
  });
  function broker() {
    const stdin = new PassThrough();
    let done: (error: Error | null, stdout: string, stderr: string) => void;
    const spy = jest.spyOn(childProcess, 'execFile').mockImplementation((...args: unknown[]) => {
      done = args[3] as typeof done;
      return { stdin } as unknown as childProcess.ChildProcess;
    });
    return {
      stdin,
      spy,
      reply: (value: unknown, error: Error | null = null) =>
        done(error, JSON.stringify(value), 'private diagnostics must never escape'),
    };
  }
  it('rejects paid models before starting a credential process', async () => {
    const { spy } = broker();
    await expect(
      nousCredentials(config, 'paid/model', new AbortController().signal),
    ).rejects.toThrow('FREE_MODEL_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
  });
  it('sends only the selected model and accepts only the exact Nous endpoint', async () => {
    const b = broker();
    const result = nousCredentials(config, model, new AbortController().signal);
    expect(JSON.parse(String(b.stdin.read()))).toEqual({ model });
    const options = b.spy.mock.calls[0]?.[2] as childProcess.ExecFileOptions;
    expect(options.env).not.toHaveProperty('DEEPSEEK_API_KEY');
    expect(options.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(options.env).not.toHaveProperty('AI_WORKSPACE_API_KEY');
    b.reply({
      provider: 'nous',
      model,
      baseUrl: 'https://inference-api.nousresearch.com/v1',
      apiKey: 'synthetic-invoke-token',
    });
    await expect(result).resolves.toMatchObject({ provider: 'nous', model });
  });
  it('rejects a foreign endpoint without revealing credentials', async () => {
    const b = broker();
    const result = nousCredentials(config, model, new AbortController().signal);
    b.reply({
      provider: 'nous',
      model,
      baseUrl: 'https://untrusted.example/v1',
      apiKey: 'private-token',
    });
    await expect(result).rejects.toThrow('HERMES_NOUS_AUTH_REQUIRED');
  });
  it('propagates only safe auth/model errors and respects cancellation', async () => {
    const b = broker();
    const result = nousCredentials(config, model, new AbortController().signal);
    b.reply({ error: 'HERMES_NOUS_FREE_MODEL_UNAVAILABLE' }, new Error('private failure'));
    await expect(result).rejects.toThrow('HERMES_NOUS_FREE_MODEL_UNAVAILABLE');
    const controller = new AbortController();
    const cancelled = nousCredentials(config, model, controller.signal);
    controller.abort();
    b.reply({}, new Error('private abort'));
    await expect(cancelled).rejects.toThrow('HERMES_CANCELLED');
  });
});
