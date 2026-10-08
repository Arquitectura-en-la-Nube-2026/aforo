import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import type { EventEnvelope, IdempotencyRecord, IdempotencyRepository, OutboxMessage, OutboxStore } from '../common';

/** Outbox table adapter: rows are written inside the business transaction, shipped by OutboxPublisher. */
@Injectable()
export class OutboxRepository implements OutboxStore {
  constructor(private readonly db: DbService) {}

  async add(q: Queryable, topic: string, envelope: EventEnvelope<unknown>): Promise<void> {
    await q.query(
      'INSERT INTO outbox (id, topic, type, correlation_id, payload) VALUES ($1, $2, $3, $4, $5)',
      [envelope.messageId, topic, envelope.type, envelope.correlationId, JSON.stringify(envelope)],
    );
  }

  async findPending(limit: number): Promise<OutboxMessage[]> {
    const res = await this.db.query(
      'SELECT id, topic, type, correlation_id, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT $1',
      [limit],
    );
    return res.rows.map((r) => ({ id: r.id, topic: r.topic, type: r.type, correlationId: r.correlation_id, payload: r.payload }));
  }

  async markPublished(id: string): Promise<void> {
    await this.db.query('UPDATE outbox SET published_at = now() WHERE id = $1', [id]);
  }
}

/** Inbox table adapter: dedup by message id, claimed in the same transaction as the effect. */
@Injectable()
export class InboxRepository {
  constructor(private readonly db: DbService) {}

  async exists(messageId: string): Promise<boolean> {
    const res = await this.db.query('SELECT 1 FROM inbox WHERE message_id = $1', [messageId]);
    return res.rowCount === 1;
  }

  /** Returns false when the message was already processed. */
  async claim(q: Queryable, messageId: string, source: string): Promise<boolean> {
    const res = await q.query(
      'INSERT INTO inbox (message_id, source) VALUES ($1, $2) ON CONFLICT (message_id) DO NOTHING',
      [messageId, source],
    );
    return res.rowCount === 1;
  }
}

@Injectable()
export class IdempotencyKeyRepository implements IdempotencyRepository {
  constructor(private readonly db: DbService) {}

  async find(key: string): Promise<IdempotencyRecord | null> {
    const res = await this.db.query('SELECT * FROM idempotency_key WHERE key = $1', [key]);
    const r = res.rows[0];
    return r ? { key: r.key, requestHash: r.request_hash, statusCode: r.status_code, responseBody: r.response_body } : null;
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO idempotency_key (key, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
      [record.key, record.requestHash, record.statusCode, JSON.stringify(record.responseBody ?? null)],
    );
  }
}
