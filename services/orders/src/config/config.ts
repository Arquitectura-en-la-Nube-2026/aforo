export interface AppConfig {
  port: number;
  logLevel: string;
  databaseUrl: string;
  gcpProjectId: string;
  inventoryUrl: string;
  paymentGatewayUrl: string;
  topicOrderPaid: string;
  dbPoolMax: number;
  frontendOrigin: string;
  webhookSecret: string;
  authMode: 'cloud' | 'dev';
  http: { connectTimeoutMs: number; responseTimeoutMs: number };
  resilience: {
    failureThreshold: number;
    resetTimeoutMs: number;
    retryMaxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
}

type Env = Record<string, string | undefined>;

const required = (env: Env, name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`Missing required env var ${name}`);
  return value;
};

const int = (env: Env, name: string, fallback?: number): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    if (fallback === undefined) throw new Error(`Missing required env var ${name}`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Env var ${name} must be a non-negative integer`);
  return value;
};

export function loadConfig(env: Env = process.env): AppConfig {
  const authMode = env.AUTH_MODE ?? 'cloud';
  if (authMode !== 'cloud' && authMode !== 'dev') throw new Error('AUTH_MODE must be "cloud" or "dev"');
  return {
    port: int(env, 'PORT', 8080),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: required(env, 'DATABASE_URL'),
    gcpProjectId: required(env, 'GCP_PROJECT_ID'),
    inventoryUrl: required(env, 'INVENTORY_URL').replace(/\/$/, ''),
    paymentGatewayUrl: required(env, 'PAYMENT_GATEWAY_URL').replace(/\/$/, ''),
    topicOrderPaid: required(env, 'TOPIC_ORDER_PAID'),
    dbPoolMax: int(env, 'DB_POOL_MAX', 3),
    frontendOrigin: required(env, 'FRONTEND_ORIGIN').replace(/\/$/, ''),
    webhookSecret: required(env, 'WEBHOOK_SECRET'),
    authMode,
    http: {
      connectTimeoutMs: int(env, 'HTTP_CONNECT_TIMEOUT_MS', 500),
      responseTimeoutMs: int(env, 'HTTP_RESPONSE_TIMEOUT_MS', 2000),
    },
    resilience: {
      failureThreshold: int(env, 'CB_FAILURE_THRESHOLD', 5),
      resetTimeoutMs: int(env, 'CB_RESET_TIMEOUT_MS', 30000),
      retryMaxAttempts: int(env, 'RETRY_MAX_ATTEMPTS', 3),
      retryBaseDelayMs: int(env, 'RETRY_BASE_DELAY_MS', 200),
      retryMaxDelayMs: int(env, 'RETRY_MAX_DELAY_MS', 5000),
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
