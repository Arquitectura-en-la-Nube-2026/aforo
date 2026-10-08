import { createHash } from "node:crypto";

/** What a service stores per Idempotency-Key (contracts/conventions.md, "Idempotency"). */
export interface IdempotencyRecord {
  key: string;
  /** SHA-256 of the request, from idempotencyRequestHash. */
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
}

/**
 * The service's adapter over its own table. Suggested: key text PK, request_hash text,
 * status_code integer, response_body jsonb, created_at timestamptz. `save` must keep the first
 * record for a key (INSERT ... ON CONFLICT (key) DO NOTHING).
 */
export interface IdempotencyRepository {
  find(key: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
}

/**
 * Fingerprint of one request. Besides the body it covers the method, the path and the user, so the
 * same key sent to another endpoint, or by another buyer, is a conflict and never replays someone
 * else's response.
 */
export function idempotencyRequestHash(input: {
  method: string;
  path: string;
  userId?: string;
  body: unknown;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([input.method.toUpperCase(), input.path, input.userId ?? null, input.body ?? null]))
    .digest("hex");
}
