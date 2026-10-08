import { Global, Injectable, Module } from "@nestjs/common";
import type { EventEnvelope, IdempotencyRecord, IdempotencyRepository, OutboxMessage, OutboxStore } from "@aforo/common";
import { IDEMPOTENCY_REPOSITORY, OUTBOX_STORE } from "@aforo/common/nest";
import { DbService, type Queryable } from "../db/db.service";

/** Writes a fact inside the caller's business transaction; OutboxPublisher ships it after commit. */
export async function addToOutbox(
  q: Queryable,
  eventId: string,
  topic: string,
  envelope: EventEnvelope,
): Promise<void> {
  await q.query(
    "INSERT INTO outbox (id, event_id, topic, type, correlation_id, payload) VALUES ($1, $2, $3, $4, $5, $6)",
    [envelope.messageId, eventId, topic, envelope.type, envelope.correlationId, JSON.stringify(envelope)],
  );
}

@Injectable()
export class OutboxRepository implements OutboxStore {
  constructor(private readonly db: DbService) {}

  async findPending(limit: number): Promise<OutboxMessage[]> {
    const { rows } = await this.db.query<{
      id: string;
      topic: string;
      type: string;
      correlation_id: string;
      payload: EventEnvelope;
    }>(
      "SELECT id, topic, type, correlation_id, payload FROM outbox WHERE published_at IS NULL ORDER BY seq LIMIT $1",
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      type: row.type,
      correlationId: row.correlation_id,
      payload: row.payload,
    }));
  }

  async markPublished(id: string): Promise<void> {
    await this.db.query("UPDATE outbox SET published_at = now() WHERE id = $1", [id]);
  }
}

@Injectable()
export class IdempotencyKeyRepository implements IdempotencyRepository {
  constructor(private readonly db: DbService) {}

  async find(key: string): Promise<IdempotencyRecord | null> {
    const { rows } = await this.db.query<{
      key: string;
      request_hash: string;
      status_code: number;
      response_body: unknown;
    }>("SELECT key, request_hash, status_code, response_body FROM idempotency_key WHERE key = $1", [key]);
    const row = rows[0];
    return row
      ? { key: row.key, requestHash: row.request_hash, statusCode: row.status_code, responseBody: row.response_body }
      : null;
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO idempotency_key (key, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
      [record.key, record.requestHash, record.statusCode, JSON.stringify(record.responseBody ?? null)],
    );
  }
}

/** Exposes the table adapters under the tokens @aforo/common's modules look for. */
@Global()
@Module({
  providers: [
    OutboxRepository,
    IdempotencyKeyRepository,
    { provide: OUTBOX_STORE, useExisting: OutboxRepository },
    { provide: IDEMPOTENCY_REPOSITORY, useExisting: IdempotencyKeyRepository },
  ],
  exports: [OUTBOX_STORE, IDEMPOTENCY_REPOSITORY],
})
export class StoresModule {}
