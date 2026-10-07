export type InboxResult = 'applied' | 'duplicate';

/** The service's database adapter inserts into an inbox table with a unique message_id. */
export interface InboxTransaction {
  insertIfAbsent(messageId: string): Promise<boolean>;
}

/** Runs work in one database transaction, committing on success and rolling back on failure. */
export interface InboxStore<TTransaction extends InboxTransaction> {
  transaction<TResult>(work: (transaction: TTransaction) => Promise<TResult>): Promise<TResult>;
}

/**
 * Applies a message and records its id in the same database transaction.
 *
 * The effect must use the transaction passed to it, not a separate connection. The adapter's
 * insertIfAbsent must use a unique message_id (for example INSERT ... ON CONFLICT DO NOTHING),
 * so concurrent deliveries cannot both apply the effect. Inserting before the effect is safe
 * because a failed effect rolls back the inbox row along with its own writes.
 *
 * Redis consumers cannot implement this callback with separate commands. They must check the
 * inbox key, update their projection and set the key in one service-specific Lua script.
 */
export function consumeOnce<TTransaction extends InboxTransaction>(
  store: InboxStore<TTransaction>,
  messageId: string,
  effect: (transaction: TTransaction) => Promise<void>,
): Promise<InboxResult> {
  return store.transaction<InboxResult>(async (transaction) => {
    if (!(await transaction.insertIfAbsent(messageId))) return 'duplicate';
    await effect(transaction);
    return 'applied';
  });
}
