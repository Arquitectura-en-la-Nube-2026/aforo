export type FaultMode = 'none' | 'error' | 'timeout';

export interface Config {
  logLevel: string;
  gcpProjectId: string;
  gcpRegion: string;
  publicBaseUrl: string;
  ordersWebhookUrl: string;
  webhookSecret: string;
  webhookDelaySeconds: number;
  tasksQueue: string;
  selfUrl: string;
  tasksInvokerServiceAccount: string;
  faultMode: FaultMode;
  faultDelayMs: number;
  dispatchTimeoutMs: number;
}

type Env = Record<string, string | undefined>;

const required = (env: Env, name: string): string => {
  const v = env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const int = (env: Env, name: string, fallback: number): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Env var ${name} must be a non-negative integer`);
  return n;
};

export function loadConfig(env: Env = process.env): Config {
  const faultMode = env.FAULT_MODE ?? 'none';
  if (faultMode !== 'none' && faultMode !== 'error' && faultMode !== 'timeout') {
    throw new Error('FAULT_MODE must be none, error or timeout');
  }
  return {
    logLevel: env.LOG_LEVEL ?? 'info',
    gcpProjectId: required(env, 'GCP_PROJECT_ID'),
    gcpRegion: required(env, 'GCP_REGION'),
    publicBaseUrl: required(env, 'PUBLIC_BASE_URL').replace(/\/$/, ''),
    ordersWebhookUrl: required(env, 'ORDERS_WEBHOOK_URL'),
    webhookSecret: required(env, 'WEBHOOK_SECRET'),
    webhookDelaySeconds: int(env, 'WEBHOOK_DELAY_SECONDS', 2),
    tasksQueue: required(env, 'TASKS_QUEUE'),
    selfUrl: required(env, 'SELF_URL').replace(/\/$/, ''),
    tasksInvokerServiceAccount: required(env, 'TASKS_INVOKER_SERVICE_ACCOUNT'),
    faultMode,
    faultDelayMs: int(env, 'FAULT_DELAY_MS', 5000),
    dispatchTimeoutMs: int(env, 'DISPATCH_TIMEOUT_MS', 20000),
  };
}
