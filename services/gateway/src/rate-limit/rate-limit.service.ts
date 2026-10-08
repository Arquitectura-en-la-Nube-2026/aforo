import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { StructuredLogger } from "@aforo/common";
import { ShutdownService } from "@aforo/common/nest";
import Redis from "ioredis";
import type { GatewayConfig } from "../config/gateway-config";

const WINDOW_SECONDS = 60;

// INCR and the first EXPIRE as one unit: two commands could leave a counter with no expiry if the
// process died in between, and that IP would be blocked forever. Returns {count, secondsLeft}.
const HIT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

type HitRedis = Redis & { rateLimitHit(key: string, windowSeconds: number): Promise<[number, number]> };

/**
 * Per-client quota in a fixed one-minute window, shared by every Gateway instance through Redis. It
 * must not be per-instance memory (services/gateway/README.md): with 3 instances a client would get
 * three times the quota, and a restart would reset it.
 *
 * It FAILS OPEN. Redis is a soft dependency here: with no REDIS_URL (Memorystore off, ADR-0001) or a
 * Redis that does not answer, requests pass and a warning is logged. Blocking every buyer because the
 * counter store is down would turn a quota into an outage.
 */
@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "gateway");
  private readonly client: HitRedis | null;
  private lastError = "";

  constructor(
    @Inject("GATEWAY_CONFIG") config: GatewayConfig,
    shutdown: ShutdownService,
  ) {
    this.client = config.redisUrl ? this.connect(config.redisUrl) : null;
    shutdown.onClose("rate-limit-redis", async () => {
      if (!this.client) return;
      if (this.client.status === "ready") await this.client.quit();
      else this.client.disconnect();
    });
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.write("WARNING", "rate_limit.disabled", { detail: "REDIS_URL is empty; the per-IP quota is not enforced" });
      return;
    }
    this.client.connect().catch(() => undefined); // failures are logged by the "error" listener
  }

  /** Counts one request of `key` in `scope` and says whether it is within `limit` for the current minute. */
  async hit(scope: string, key: string, limit: number, now = Date.now()): Promise<RateLimitResult> {
    if (!this.client || this.client.status !== "ready") return { allowed: true, retryAfterSeconds: 0 };
    const bucket = Math.floor(now / (WINDOW_SECONDS * 1000));
    try {
      const [count, secondsLeft] = await this.client.rateLimitHit(`ratelimit:${scope}:${key}:${bucket}`, WINDOW_SECONDS);
      return { allowed: count <= limit, retryAfterSeconds: Math.max(secondsLeft, 1) };
    } catch (error) {
      this.logFailure(error);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  private logFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message === this.lastError) return;
    this.lastError = message;
    this.logger.write("WARNING", "rate_limit.redis_error", { error: message });
  }

  private connect(url: string): HitRedis {
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      commandTimeout: 500, // the quota check sits on every queue request: a slow Redis must not slow them
      connectTimeout: 1000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    }) as HitRedis;
    client.defineCommand("rateLimitHit", { numberOfKeys: 1, lua: HIT_LUA });
    client.on("error", (error: Error) => this.logFailure(error));
    client.on("ready", () => {
      this.lastError = "";
      this.logger.write("INFO", "rate_limit.redis_ready");
    });
    return client;
  }
}
