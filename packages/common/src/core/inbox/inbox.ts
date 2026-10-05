/** Remembers which messages a consumer already processed. Each service backs it with its own store. */
export interface InboxStore {
  has(messageId: string): Promise<boolean>;
  mark(messageId: string): Promise<void>;
}

export type InboxResult = "applied" | "duplicate";

/**
 * Applies `effect` once per `messageId`.
 *
 * The effect runs BEFORE the message is marked, and it must be idempotent (events/README.md:
 * "handlers must be safe to run twice"). The reason is the crash window: if the process dies
 * between the two steps, Pub/Sub redelivers the message and the effect runs again, which is
 * harmless. Marking first would be wrong: with `inbox:M` saved and the process dead before the
 * upsert, the retry is dropped as a duplicate and the projection never receives the event.
 */
export async function consumeOnce(
  store: InboxStore,
  messageId: string,
  effect: () => Promise<void>,
): Promise<InboxResult> {
  if (await store.has(messageId)) return "duplicate";
  await effect();
  await store.mark(messageId);
  return "applied";
}
