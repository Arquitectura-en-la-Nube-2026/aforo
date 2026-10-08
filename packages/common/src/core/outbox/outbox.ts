import { StructuredLogger } from "../logging/structured-logger";
import type { EventEnvelope } from "../envelope/envelope";

/** One row of the service's `outbox` table, written inside the business transaction. */
export interface OutboxMessage {
  id: string;
  /** Pub/Sub topic ID, e.g. `aforo.orders.order-paid` (contracts/events/README.md). */
  topic: string;
  type: string;
  correlationId: string;
  /** The full envelope: JSON text, or the object a jsonb column comes back as. */
  payload: string | EventEnvelope;
}

/**
 * The service's adapter over its own `outbox` table (the DB layer stays pluggable). Suggested table:
 * id uuid PK, topic text, type text, correlation_id uuid, payload jsonb, created_at timestamptz,
 * published_at timestamptz NULL.
 */
export interface OutboxStore {
  /** Unpublished rows, oldest first. */
  findPending(limit: number): Promise<OutboxMessage[]>;
  markPublished(id: string): Promise<void>;
}

export interface OutboxTransport {
  publish(topic: string, data: Buffer, attributes: Record<string, string>): Promise<void>;
}

export interface OutboxPublisherOptions {
  batchSize?: number;
  /** Upper bound per flush, so one request never runs unbounded; housekeeping picks up the rest. */
  maxPerFlush?: number;
}

/**
 * Sends pending outbox rows to Pub/Sub and marks them sent. Call `flush()` after the business
 * transaction commits and before responding; housekeeping calls it every minute for leftovers.
 * Never a poller (ADR-0002).
 *
 * Delivery is at-least-once: a crash between publish and markPublished, or two instances flushing
 * at once, publishes a row twice. Consumers deduplicate by messageId (inbox).
 */
export class OutboxPublisher {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "unknown");
  private readonly batchSize: number;
  private readonly maxPerFlush: number;
  private running: Promise<number> | undefined;

  constructor(
    private readonly store: OutboxStore,
    private readonly transport: OutboxTransport,
    options: OutboxPublisherOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.maxPerFlush = options.maxPerFlush ?? 500;
  }

  /**
   * Publishes in order and stops at the first failure, which it rethrows: the failed row and the
   * ones after it stay pending for the next flush. Returns how many rows were published. Concurrent
   * calls in one instance share the flush in progress.
   */
  flush(): Promise<number> {
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async drain(): Promise<number> {
    let published = 0;
    while (published < this.maxPerFlush) {
      const rows = await this.store.findPending(Math.min(this.batchSize, this.maxPerFlush - published));
      for (const row of rows) {
        try {
          await this.publishOne(row);
        } catch (error) {
          this.logger.write("ERROR", "outbox.publish_failed", {
            event: "outbox_publish_failed",
            correlationId: row.correlationId,
            messageId: row.id,
            topic: row.topic,
            published,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        published += 1;
      }
      if (rows.length < this.batchSize) break;
    }
    if (published > 0) this.logger.write("INFO", "outbox.flushed", { event: "outbox_flushed", published });
    return published;
  }

  private async publishOne(row: OutboxMessage): Promise<void> {
    const text = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
    // Attributes too, not only the envelope: dead letters and filters read them without parsing (E-05).
    await this.transport.publish(row.topic, Buffer.from(text, "utf8"), {
      type: row.type,
      correlationId: row.correlationId,
    });
    await this.store.markPublished(row.id);
  }
}
