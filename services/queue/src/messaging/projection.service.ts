import { Injectable } from "@nestjs/common";
import type { EventPublishedData, SalesRulesConfiguredData } from "@aforo/common";
import { eventKey, inboxKey } from "../queue/queue-scripts";
import { RedisService } from "../redis/redis.service";

export interface EventProjection {
  salesOpensAtMs: number;
  salesClosesAtMs: number;
  openingWindowSeconds: number;
}

const EVENT_KEY_PATTERN = "event:*";
// Pub/Sub retries for minutes, not days. Keep the marker longer than its delivery window.
const INBOX_TTL_SECONDS = 24 * 60 * 60;

/**
 * The local copy of what the queue needs about an event: `event:{eventId}` (README). Built from
 * EventPublished and SalesRulesConfigured, which can arrive in either order, so each writes only
 * its own fields and neither overwrites the other. A message older than the last one of its kind is
 * skipped (PROJECT_LUA): Catalog re-emits the rules when they change, and the old ones may come last.
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly store: RedisService) {}

  async applyEventPublished(messageId: string, data: EventPublishedData, occurredAt: string): Promise<void> {
    await this.store.redis.projectionUpsert(
      eventKey(data.eventId),
      inboxKey(messageId),
      "publishedAt",
      Date.parse(occurredAt),
      INBOX_TTL_SECONDS,
      "salesOpensAt",
      data.salesOpensAt,
      "salesClosesAt",
      data.salesClosesAt,
    );
  }

  async applySalesRules(messageId: string, data: SalesRulesConfiguredData, occurredAt: string): Promise<void> {
    await this.store.redis.projectionUpsert(
      eventKey(data.eventId),
      inboxKey(messageId),
      "rulesAt",
      Date.parse(occurredAt),
      INBOX_TTL_SECONDS,
      "openingWindowSeconds",
      String(data.openingWindowSeconds),
    );
  }

  /**
   * Null while the sale window is unknown, that is until EventPublished arrives; rules alone are not
   * enough to say whether the sale is open. A missing opening window means no random window (0).
   */
  async get(eventId: string): Promise<EventProjection | null> {
    const [opens, closes, window] = await this.store.redis.hmget(
      eventKey(eventId),
      "salesOpensAt",
      "salesClosesAt",
      "openingWindowSeconds",
    );
    if (!opens || !closes) return null;
    return {
      salesOpensAtMs: Date.parse(opens),
      salesClosesAtMs: Date.parse(closes),
      openingWindowSeconds: window ? Number(window) : 0,
    };
  }

  /** Event ids with a projection. SCAN, not KEYS: it does not block Redis while it walks the keys. */
  async listEventIds(): Promise<string[]> {
    const ids: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.store.redis.scan(cursor, "MATCH", EVENT_KEY_PATTERN, "COUNT", 100);
      cursor = next;
      for (const key of keys) ids.push(key.slice("event:".length));
    } while (cursor !== "0");
    return ids;
  }
}
