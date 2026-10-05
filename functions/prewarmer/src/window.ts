// Pure logic of the pre-warmer: parse the push, compute the window, name the tasks, and decide
// whether a cool must keep the instances. No I/O here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 3600 * 1000; // Cloud Tasks limit

export interface SalesWindow {
  eventId: string;
  salesOpensAt: string;
  salesClosesAt: string;
}

export interface ParsedEvent extends SalesWindow {
  correlationId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** A window (task body or EventPublished data) with valid ids and ordered times, or null. */
export function parseWindow(value: unknown): SalesWindow | null {
  if (!isRecord(value)) return null;
  const { eventId, salesOpensAt, salesClosesAt } = value;
  if (typeof eventId !== "string" || !UUID.test(eventId)) return null;
  if (!isTimestamp(salesOpensAt) || !isTimestamp(salesClosesAt)) return null;
  if (Date.parse(salesClosesAt) <= Date.parse(salesOpensAt)) return null;
  return { eventId, salesOpensAt, salesClosesAt };
}

/** Pub/Sub push body -> EventPublished window, or null if it is not a valid envelope. */
export function parsePush(body: unknown): ParsedEvent | null {
  if (!isRecord(body) || !isRecord(body.message) || typeof body.message.data !== "string") return null;
  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(envelope) || envelope.type !== "EventPublished") return null;
  if (typeof envelope.messageId !== "string" || typeof envelope.correlationId !== "string") return null;
  const window = parseWindow(envelope.data);
  return window ? { ...window, correlationId: envelope.correlationId } : null;
}

export interface Plan {
  warm: { name: string; at: Date };
  cool: { name: string; at: Date };
}

export type PlanResult = { plan: Plan } | { skip: "window-over" | "too-far-ahead" };

const epoch = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export function warmTaskId(w: SalesWindow): string {
  return `warm-${w.eventId}-${epoch(w.salesOpensAt)}`;
}

export function coolTaskId(w: SalesWindow): string {
  return `cool-${w.eventId}-${epoch(w.salesClosesAt)}`;
}

export function planWindow(w: SalesWindow, now: Date, leadSeconds: number, holdSeconds: number): PlanResult {
  const opens = Date.parse(w.salesOpensAt);
  const warmAt = opens - leadSeconds * 1000;
  const coolAt = Math.min(Date.parse(w.salesClosesAt), opens + holdSeconds * 1000);

  if (coolAt <= now.getTime()) return { skip: "window-over" };
  if (warmAt > now.getTime() + MAX_SCHEDULE_AHEAD_MS) return { skip: "too-far-ahead" };

  return {
    plan: {
      warm: { name: warmTaskId(w), at: new Date(Math.max(warmAt, now.getTime())) },
      cool: { name: coolTaskId(w), at: new Date(coolAt) },
    },
  };
}

/**
 * The queue is the state. Another window is open when its cool task is still pending and its
 * warm task is not (the warm already ran). The cool task being executed is excluded.
 */
export function anotherWindowOpen(pendingTaskIds: string[], currentCoolTaskId: string): boolean {
  const pending = new Set(pendingTaskIds);
  const pendingWarmEvents = new Set(
    pendingTaskIds.filter((id) => id.startsWith("warm-")).map((id) => id.slice(5, 41)),
  );
  return [...pending].some(
    (id) => id.startsWith("cool-") && id !== currentCoolTaskId && !pendingWarmEvents.has(id.slice(5, 41)),
  );
}
