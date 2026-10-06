import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { StructuredLogger } from "@aforo/common";
import type { QueueConfig } from "../config/queue-config";
import { ProjectionService } from "../messaging/projection.service";
import { QUEUE_CONFIG, RedisService } from "../redis/redis.service";
import { admissionLockKey, admittedPrefix, queueKey } from "./queue-scripts";
import { passExpiryMs } from "./queue-status";

/**
 * RF-06. Every instance runs the timer (the one in-process timer the repo allows, ADR-0002), so each
 * tick first tries `SET admission:{eventId}:{tick} 1 NX`: only the instance that wins the lock
 * admits. The lock keeps two instances from admitting the same tick twice; it does NOT protect the
 * queue-to-pass move itself, that is ADMIT_LUA running as one atomic unit.
 */
@Injectable()
export class AdmissionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "queue");
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(QUEUE_CONFIG) private readonly config: QueueConfig,
    private readonly store: RedisService,
    private readonly projection: ProjectionService,
  ) {}

  onApplicationBootstrap(): void {
    // unref: the timer must not be the thing that keeps the process alive.
    this.timer = setInterval(() => void this.safeTick(), this.config.admissionIntervalSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** The tick of the timer: never throws, because an unhandled rejection would end the process. */
  private async safeTick(): Promise<void> {
    try {
      await this.admitTick();
    } catch (error) {
      // Redis down or slow: skip this tick, the next one retries. Nothing is lost, buyers stay queued.
      this.logger.write("WARNING", "admission.tick_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** One admission round over every known event. Returns how many buyers were admitted. */
  async admitTick(now = Date.now()): Promise<number> {
    const intervalMs = this.config.admissionIntervalSeconds * 1000;
    const tick = Math.floor(now / intervalMs);
    let total = 0;
    for (const eventId of await this.projection.listEventIds()) {
      const redis = this.store.redis;
      if ((await redis.zcard(queueKey(eventId))) === 0) continue;
      const won = await redis.set(admissionLockKey(eventId, tick), "1", "EX", this.config.admissionIntervalSeconds * 2, "NX");
      if (won !== "OK") continue;
      const admitted = await this.admit(eventId, now);
      if (admitted > 0) this.logger.write("INFO", "queue.admitted", { eventId, admitted, tick });
      total += admitted;
    }
    return total;
  }

  private async admit(eventId: string, now: number): Promise<number> {
    const { admissionBatchSize, passTtlSeconds } = this.config;
    const expiresAtMs = passExpiryMs(now, passTtlSeconds);
    // One fresh opaque token per slot of the batch: the script pops the users and needs their tokens
    // in the same step, but only the caller can generate randomness.
    const tokens = Array.from({ length: admissionBatchSize }, () => `p_${randomBytes(18).toString("base64url")}`);
    const admitted = await this.store.redis.queueAdmit(
      queueKey(eventId),
      admissionBatchSize,
      passTtlSeconds,
      expiresAtMs,
      admittedPrefix(eventId),
      ...tokens,
    );
    return admitted.length;
  }
}
