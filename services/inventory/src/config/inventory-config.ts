export type ExpirySchedulerKind = "cloud-tasks" | "local";

export interface InventoryConfig {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  databaseUrl: string;
  /** ADR-0005: 2 per instance in the cloud, 1 when running locally against dev. */
  dbPoolMax: number;
  gcpProjectId: string;
  gcpRegion: string;
  topicReservationExpired: string;
  expiryScheduler: ExpirySchedulerKind;
  tasksQueue: string;
  /** This service's own URL: the expiry task calls SELF_URL/internal/v1/reservations/{id}/expire. */
  selfUrl: string;
  tasksInvokerServiceAccount: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadInventoryConfig(env = process.env): InventoryConfig {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  const dbPoolMax = Number(env.DB_POOL_MAX ?? 2);
  if (!Number.isInteger(dbPoolMax) || dbPoolMax < 1) throw new Error("DB_POOL_MAX must be a positive integer");

  const logLevel = (env.LOG_LEVEL?.trim() || "info") as InventoryConfig["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel))
    throw new Error("LOG_LEVEL must be debug, info, warn or error");

  const expiryScheduler = (env.EXPIRY_SCHEDULER?.trim() || "cloud-tasks") as ExpirySchedulerKind;
  if (expiryScheduler !== "cloud-tasks" && expiryScheduler !== "local") {
    throw new Error("EXPIRY_SCHEDULER must be cloud-tasks or local");
  }
  const cloud = expiryScheduler === "cloud-tasks";

  return {
    port,
    logLevel,
    databaseUrl: required(env, "DATABASE_URL"),
    dbPoolMax,
    gcpProjectId: required(env, "GCP_PROJECT_ID"),
    gcpRegion: env.GCP_REGION?.trim() || "southamerica-east1",
    topicReservationExpired: env.TOPIC_RESERVATION_EXPIRED?.trim() || "aforo.inventory.reservation-expired",
    expiryScheduler,
    tasksQueue: env.TASKS_QUEUE?.trim() || "reservation-expiry",
    selfUrl: (cloud ? required(env, "SELF_URL") : env.SELF_URL?.trim() || `http://127.0.0.1:${port}`).replace(
      /\/+$/,
      "",
    ),
    tasksInvokerServiceAccount: cloud ? required(env, "TASKS_INVOKER_SERVICE_ACCOUNT") : "",
  };
}
