import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DomainError, StructuredLogger } from "@aforo/common";
import { HealthService, ShutdownService } from "@aforo/common/nest";
import Redis from "ioredis";
import type { QueueConfig } from "../config/queue-config";
import { ADMIT_LUA, JOIN_LUA, PROJECT_LUA, STATUS_LUA, type QueueScripts } from "../queue/queue-scripts";

export const QUEUE_CONFIG = "QUEUE_CONFIG";

export type QueueRedis = Redis & QueueScripts;

/**
 * The only owner of the Redis connection. It connects lazily and never blocks boot: with no
 * REDIS_URL (Memorystore off, ADR-0001) or no connection, `redis` throws the 500 INTERNAL the
 * contract asks for ("queue store not available") and /health/ready answers 503.
 */
@Injectable()
export class RedisService implements OnModuleInit {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "queue");
  private readonly client: QueueRedis | null;
  private lastError = "";

  constructor(
    @Inject(QUEUE_CONFIG) config: QueueConfig,
    health: HealthService,
    shutdown: ShutdownService,
  ) {
    this.client = config.redisUrl ? this.connect(config.redisUrl) : null;
    health.register("redis", async () => {
      await this.redis.ping();
    });
    shutdown.onClose("redis", async () => {
      if (!this.client) return;
      if (this.client.status === "ready") await this.client.quit();
      else this.client.disconnect();
    });
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.write("WARNING", "redis.not_configured", { detail: "REDIS_URL is empty; queue endpoints answer 500" });
      return;
    }
    this.client.connect().catch(() => undefined); // failures are logged by the "error" listener
  }

  /** The connection, or the 500 INTERNAL of the contract when there is none. */
  get redis(): QueueRedis {
    if (!this.client || this.client.status !== "ready") {
      throw new DomainError("INTERNAL", "queue store not available");
    }
    return this.client;
  }

  private connect(url: string): QueueRedis {
    const client = new Redis(url, {
      lazyConnect: true,
      // Fail fast instead of queueing commands while disconnected: a request must answer 500, not hang.
      enableOfflineQueue: false,
      commandTimeout: 2000,
      connectTimeout: 2000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    }) as QueueRedis;
    client.defineCommand("queueJoin", { numberOfKeys: 2, lua: JOIN_LUA });
    client.defineCommand("queueStatus", { numberOfKeys: 2, lua: STATUS_LUA });
    client.defineCommand("queueAdmit", { numberOfKeys: 1, lua: ADMIT_LUA });
    client.defineCommand("projectionUpsert", { numberOfKeys: 1, lua: PROJECT_LUA });
    // Without a listener an "error" event crashes the process. Log each distinct failure once, not
    // on every reconnect attempt.
    client.on("error", (error: Error) => {
      if (error.message === this.lastError) return;
      this.lastError = error.message;
      this.logger.write("WARNING", "redis.error", { error: error.message });
    });
    client.on("ready", () => {
      this.lastError = "";
      this.logger.write("INFO", "redis.ready");
    });
    return client;
  }
}
