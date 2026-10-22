import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';

/** Only basic OS variables cross either subprocess boundary. */
export function hermesEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
  ])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}

export function nousCredentials(
  config: ConfigService,
  model: string,
  signal: AbortSignal,
): Promise<{ provider: 'nous'; model: string; baseUrl: string; apiKey: string }> {
  if (!model.endsWith(':free'))
    return Promise.reject(new Error('HERMES_NOUS_FREE_MODEL_UNAVAILABLE'));
  return new Promise((accept, reject) => {
    const env = {
      ...hermesEnvironment(),
      OSCAR_HERMES_AUTH_ROOT: config.get<string>('HERMES_AUTH_ROOT'),
      HERMES_HOME: config.get<string>('HERMES_AUTH_HOME'),
      HERMES_DISABLE_MCP: '1',
      HERMES_DISABLE_TELEMETRY: '1',
    };
    const child = execFile(
      config.get<string>('HERMES_AUTH_PYTHON')!,
      [resolve('scripts/hermes/nous_credentials.py')],
      { env, signal, timeout: 30000, maxBuffer: 32768, windowsHide: true },
      (error, stdout) => {
        if (signal.aborted) return reject(new Error('HERMES_CANCELLED'));
        let value: Record<string, unknown>;
        try {
          value = JSON.parse(stdout) as Record<string, unknown>;
        } catch {
          return reject(new Error('HERMES_NOUS_AUTH_REQUIRED'));
        }
        if (error || value.error)
          return reject(
            new Error(
              value.error === 'HERMES_NOUS_FREE_MODEL_UNAVAILABLE'
                ? value.error
                : 'HERMES_NOUS_AUTH_REQUIRED',
            ),
          );
        if (
          value.provider !== 'nous' ||
          value.model !== model ||
          value.baseUrl !== 'https://inference-api.nousresearch.com/v1' ||
          typeof value.apiKey !== 'string' ||
          !value.apiKey ||
          value.apiKey.length > 16000
        )
          return reject(new Error('HERMES_NOUS_AUTH_REQUIRED'));
        accept({ provider: 'nous', model, baseUrl: value.baseUrl, apiKey: value.apiKey });
      },
    );
    child.stdin?.on('error', () => {
      /* execFile callback reports startup/pipe failure safely. */
    });
    child.stdin?.end(JSON.stringify({ model }) + '\n');
  });
}
