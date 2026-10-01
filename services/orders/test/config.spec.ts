import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config/config';

const parseEnv = (file: string) =>
  Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

describe('config', () => {
  const env = parseEnv(join(__dirname, '..', '.env.example'));

  it('loads .env.example with the agreed resilience parameters', () => {
    const c = loadConfig(env);
    expect(c.http).toEqual({ connectTimeoutMs: 500, responseTimeoutMs: 2000 });
    expect(c.resilience).toMatchObject({ failureThreshold: 5, resetTimeoutMs: 30000, retryMaxAttempts: 3 });
  });

  it('fails fast when a required variable is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow('DATABASE_URL');
  });
});
