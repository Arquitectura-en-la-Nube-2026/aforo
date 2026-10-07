export interface QueueStatus {
  eventId: string;
  state: "WAITING" | "ADMITTED";
  position: number;
  aheadOf: number;
  estimatedWaitSeconds: number;
  passToken: string | null;
  passExpiresAt: string | null;
}

export interface Pacing {
  admissionBatchSize: number;
  admissionIntervalSeconds: number;
}

/**
 * A buyer who is waiting. The contract does not give formulas, only minimums (queue.yaml: position,
 * aheadOf and estimatedWaitSeconds are >= 0), so these are ours:
 *  - aheadOf = position - 1.
 *  - estimatedWaitSeconds = ceil(position / batch) * interval: the number of admission ticks needed
 *    to reach this position, times the tick length. It is an upper bound for the first tick.
 * Example with batch 500 and interval 5 s: position 1 waits at most 5 s; position 500 also 5 s (the
 * first tick takes the first 500); position 501 needs two ticks, 10 s.
 */
export function waitingStatus(eventId: string, position: number, pacing: Pacing): QueueStatus {
  return {
    eventId,
    state: "WAITING",
    position,
    aheadOf: position - 1,
    estimatedWaitSeconds: Math.ceil(position / pacing.admissionBatchSize) * pacing.admissionIntervalSeconds,
    passToken: null,
    passExpiresAt: null,
  };
}

/**
 * A buyer who has a pass. The value stored in `admitted:{eventId}:{userId}` is
 * `<expiresAtMs>:<passToken>` (written by ADMIT_LUA). position, aheadOf and estimatedWaitSeconds are 0
 * (queue.yaml: "0 when admitted"); computing aheadOf as position - 1 would give -1 and break the
 * minimum. The expiry is stored with the pass, not derived from the key's remaining TTL, so repeated
 * calls return the same passExpiresAt instead of one that drifts by a few milliseconds each time.
 */
export function admittedStatus(eventId: string, stored: string): QueueStatus {
  const separator = stored.indexOf(":");
  const expiresAtMs = Number(stored.slice(0, separator));
  return {
    eventId,
    state: "ADMITTED",
    position: 0,
    aheadOf: 0,
    estimatedWaitSeconds: 0,
    passToken: stored.slice(separator + 1),
    // Whole seconds, like the contract examples ("2026-10-01T15:10:00Z").
    passExpiresAt: new Date(expiresAtMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/** Pass expiry in whole seconds, never later than the Redis key's TTL. */
export function passExpiryMs(now: number, passTtlSeconds: number): number {
  return Math.floor((now + passTtlSeconds * 1000) / 1000) * 1000;
}

/**
 * RF-05. Inside the opening window the score is random within the window; after it, the arrival
 * time. Both live on the same axis (epoch ms), and the window ends exactly where timestamps resume,
 * so every buyer who joined inside the window sorts before everyone who joins after it.
 */
export function scoreFor(
  now: number,
  salesOpensAtMs: number,
  openingWindowSeconds: number,
  random: () => number = Math.random,
): number {
  const windowMs = openingWindowSeconds * 1000;
  if (windowMs > 0 && now < salesOpensAtMs + windowMs) return salesOpensAtMs + random() * windowMs;
  return now;
}
