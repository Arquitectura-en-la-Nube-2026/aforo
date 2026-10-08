export interface CatalogConfig {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  databaseUrl: string;
  /** ADR-0005: 2 per instance in the cloud, 1 when running locally against dev. */
  dbPoolMax: number;
  gcpProjectId: string;
  topicEventPublished: string;
  topicSalesRulesConfigured: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadCatalogConfig(env = process.env): CatalogConfig {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  const dbPoolMax = Number(env.DB_POOL_MAX ?? 2);
  if (!Number.isInteger(dbPoolMax) || dbPoolMax < 1) throw new Error("DB_POOL_MAX must be a positive integer");

  const logLevel = (env.LOG_LEVEL?.trim() || "info") as CatalogConfig["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel))
    throw new Error("LOG_LEVEL must be debug, info, warn or error");

  return {
    port,
    logLevel,
    databaseUrl: required(env, "DATABASE_URL"),
    dbPoolMax,
    gcpProjectId: required(env, "GCP_PROJECT_ID"),
    topicEventPublished: env.TOPIC_EVENT_PUBLISHED?.trim() || "aforo.catalog.event-published",
    topicSalesRulesConfigured: env.TOPIC_SALES_RULES_CONFIGURED?.trim() || "aforo.catalog.sales-rules-configured",
  };
}
