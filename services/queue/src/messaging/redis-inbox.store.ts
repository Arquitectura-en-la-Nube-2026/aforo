import { Injectable } from "@nestjs/common";
import type { InboxStore } from "@aforo/common";
import { inboxKey } from "../queue/queue-scripts";
import { RedisService } from "../redis/redis.service";

// Pub/Sub retries a message for minutes, not days: a day is more than enough to recognise a duplicate.
const INBOX_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class RedisInboxStore implements InboxStore {
  constructor(private readonly store: RedisService) {}

  async has(messageId: string): Promise<boolean> {
    return (await this.store.redis.exists(inboxKey(messageId))) === 1;
  }

  async mark(messageId: string): Promise<void> {
    await this.store.redis.set(inboxKey(messageId), "1", "EX", INBOX_TTL_SECONDS);
  }
}
