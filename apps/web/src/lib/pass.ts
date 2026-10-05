// The queue pass (apps/web/README.md, rule 2): kept in memory and mirrored in sessionStorage so a
// refresh does not lose it. It is sent as X-Queue-Pass even though nobody verifies it today (D-07),
// so the client does not change when verification arrives.
//
// OUT-OF-SCOPE(D-07): no client-side verification. The pass only enables the buy screen.
import { readSession } from '@/lib/session';

export interface QueuePass {
  passToken: string;
  passExpiresAt: string;
}

// The key includes the signed-in buyer. sessionStorage lives as long as the tab and signing out only
// clears the session, so a key per event alone handed Ana's pass to Ben when he signed in on the same
// tab, and the buy screen treated it as his.
const memory = new Map<string, QueuePass>();
const key = (eventId: string, owner = readSession()?.user.id) =>
  `aforo.pass.${owner ?? 'anonymous'}.${eventId}`;

function isLive(pass: QueuePass): boolean {
  return new Date(pass.passExpiresAt).getTime() > Date.now();
}

/**
 * `owner` is the buyer who queued for the pass. The queue screen passes it: the session is shared by
 * every tab, so whoever is signed in when the admission arrives may already be someone else.
 */
export function savePass(eventId: string, pass: QueuePass, owner = readSession()?.user.id) {
  memory.set(key(eventId, owner), pass);
  try {
    window.sessionStorage.setItem(key(eventId, owner), JSON.stringify(pass));
  } catch {
    // sessionStorage blocked: the pass survives only until reload.
  }
}

export function clearPass(eventId: string) {
  memory.delete(key(eventId));
  try {
    window.sessionStorage.removeItem(key(eventId));
  } catch {
    // Nothing to clear.
  }
}

/** The pass of the signed-in buyer for an event, or null when there is none or it already expired. */
export function getPass(eventId: string): QueuePass | null {
  let pass = memory.get(key(eventId)) ?? null;
  if (!pass) {
    try {
      const raw = window.sessionStorage.getItem(key(eventId));
      if (raw) pass = JSON.parse(raw) as QueuePass;
    } catch {
      pass = null;
    }
  }
  if (pass && !isLive(pass)) {
    clearPass(eventId);
    return null;
  }
  if (pass) memory.set(key(eventId), pass);
  return pass;
}

// "Payment started" marker: after the buyer comes back from the payment page the order may still
// read PENDING_PAYMENT for a moment (the webhook arrives after the redirect). The marker lets the
// order screen say "confirming your payment" instead of "pay now".
const payKey = (orderId: string) => `aforo.paying.${orderId}`;

export function markPaymentStarted(orderId: string) {
  try {
    window.sessionStorage.setItem(payKey(orderId), '1');
  } catch {
    // Without the marker the screen simply shows the pending state.
  }
}

export function wasPaymentStarted(orderId: string): boolean {
  try {
    return window.sessionStorage.getItem(payKey(orderId)) === '1';
  } catch {
    return false;
  }
}
