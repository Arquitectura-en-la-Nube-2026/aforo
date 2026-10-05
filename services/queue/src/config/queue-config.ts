export interface QueueConfig {
  port: number;
  /** Null while Memorystore is off (ADR-0001): the service boots and answers 500 until Redis is there. */
  redisUrl: string | null;
  admissionBatchSize: number;
  admissionIntervalSeconds: number;
  passTtlSeconds: number;
  sseHeartbeatSeconds: number;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadQueueConfig(env = process.env): QueueConfig {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");

  const redisUrl = env.REDIS_URL?.trim() || null;
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) throw new Error("REDIS_URL must start with redis:// or rediss://");

  return {
    port,
    redisUrl,
    admissionBatchSize: positiveInteger(env, "ADMISSION_BATCH_SIZE", 500),
    admissionIntervalSeconds: positiveInteger(env, "ADMISSION_INTERVAL_SECONDS", 5),
    passTtlSeconds: positiveInteger(env, "PASS_TTL_SECONDS", 600),
    sseHeartbeatSeconds: positiveInteger(env, "SSE_HEARTBEAT_SECONDS", 15),
  };
}
