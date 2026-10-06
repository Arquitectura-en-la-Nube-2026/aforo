export interface GatewayConfig {
  port: number;
  authSecret: string;
  authIssuer: string;
  frontendOrigin: string;
  queueUrl: string;
  /** Null while Memorystore is off: the per-IP quota is then not enforced (it fails open). */
  redisUrl: string | null;
  rateLimitQueuePerMinute: number;
  /** "cloud" (Terraform): calls to private services carry a Google ID token. "dev" (local): they do not. */
  authMode: "dev" | "cloud";
  /** Where the instance's metadata server answers. Only tests change it (GCE_METADATA_HOST). */
  metadataHost: string;
}

export function loadGatewayConfig(env = process.env): GatewayConfig {
  const authSecret = env.AUTH_SECRET?.trim();
  if (!authSecret || Buffer.byteLength(authSecret, "utf8") < 32 || authSecret === "change-me") {
    throw new Error("AUTH_SECRET must be configured with at least 32 bytes");
  }

  const authIssuer = env.AUTH_ISSUER?.trim();
  const frontendOrigin = env.FRONTEND_ORIGIN?.trim();
  if (!authIssuer || !URL.canParse(authIssuer)) throw new Error("AUTH_ISSUER must be a valid URL");
  if (!frontendOrigin || !URL.canParse(frontendOrigin) || new URL(frontendOrigin).origin !== frontendOrigin) {
    throw new Error("FRONTEND_ORIGIN must be a valid URL");
  }

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");

  const queueUrl = env.QUEUE_URL?.trim().replace(/\/+$/, "");
  if (!queueUrl || !URL.canParse(queueUrl)) throw new Error("QUEUE_URL must be a valid URL");

  const redisUrl = env.REDIS_URL?.trim() || null;
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) throw new Error("REDIS_URL must start with redis:// or rediss://");

  const rateLimitQueuePerMinute = Number(env.RATE_LIMIT_QUEUE_PER_MIN ?? 60);
  if (!Number.isInteger(rateLimitQueuePerMinute) || rateLimitQueuePerMinute < 1) {
    throw new Error("RATE_LIMIT_QUEUE_PER_MIN must be a positive integer");
  }

  const authMode = env.AUTH_MODE?.trim() || "dev";
  if (authMode !== "dev" && authMode !== "cloud") throw new Error("AUTH_MODE must be dev or cloud");
  const metadataHost = env.GCE_METADATA_HOST?.trim() || "metadata.google.internal";

  return { port, authSecret, authIssuer, frontendOrigin, queueUrl, redisUrl, rateLimitQueuePerMinute, authMode, metadataHost };
}
