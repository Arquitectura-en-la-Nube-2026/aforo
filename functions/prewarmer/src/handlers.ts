// Route logic with its dependencies injected, so it is testable without GCP.
import type { StructuredLogger } from "@aforo/common";
import type { Config } from "./config.ts";
import type { Gcp } from "./gcp.ts";
import { anotherWindowOpen, coolTaskId, parsePush, parseWindow, planWindow, type SalesWindow } from "./window.ts";

export interface Reply {
  status: number;
  body?: unknown;
}

export interface Deps {
  config: Config;
  gcp: Gcp;
  logger: StructuredLogger;
  now: () => Date;
}

type ServiceChange = { service: string; from: number; to: number };

async function setAll(
  deps: Deps,
  action: "WARM" | "COOL",
  window: SalesWindow,
  correlationId: string,
  target: (current: number, warmMinimum: number) => number,
): Promise<ServiceChange[]> {
  const changes: ServiceChange[] = [];
  for (const { service, warmMinimum } of deps.config.targets) {
    const from = await deps.gcp.getMinInstances(service);
    const to = target(from, warmMinimum);
    if (to !== from) {
      await deps.gcp.setMinInstances(service, to);
      deps.logger.write("INFO", "Minimum instances changed", {
        event: "prewarm_applied",
        action,
        service,
        from,
        to,
        eventId: window.eventId,
        correlationId,
      });
    }
    changes.push({ service, from, to });
  }
  return changes;
}

/** POST /events/prewarmer-event-published */
export async function onEventPublished(deps: Deps, body: unknown): Promise<Reply> {
  const event = parsePush(body);
  if (!event) {
    deps.logger.write("WARNING", "Not a valid EventPublished envelope", { event: "prewarm_invalid" });
    return { status: 400 };
  }

  const result = planWindow(event, deps.now(), deps.config.leadSeconds, deps.config.holdSeconds);
  if ("skip" in result) {
    deps.logger.write("INFO", "Window not scheduled", {
      event: "prewarm_skipped",
      reason: result.skip,
      eventId: event.eventId,
      correlationId: event.correlationId,
    });
    return { status: 204 };
  }

  const task = { eventId: event.eventId, salesOpensAt: event.salesOpensAt, salesClosesAt: event.salesClosesAt };
  const { warm, cool } = result.plan;
  const warmCreated = await deps.gcp.createTask(warm.name, warm.at, "/windows/warm", task, event.correlationId);
  const coolCreated = await deps.gcp.createTask(cool.name, cool.at, "/windows/cool", task, event.correlationId);
  deps.logger.write("INFO", "Window scheduled", {
    event: "prewarm_scheduled",
    eventId: event.eventId,
    warmAt: warm.at.toISOString(),
    coolAt: cool.at.toISOString(),
    created: { warm: warmCreated, cool: coolCreated },
    correlationId: event.correlationId,
  });
  return { status: 204 };
}

/** POST /windows/warm */
export async function warmWindow(deps: Deps, body: unknown, correlationId: string): Promise<Reply> {
  const window = parseWindow(body);
  if (!window) return { status: 400 };
  const services = await setAll(deps, "WARM", window, correlationId, (current, warm) => Math.max(current, warm));
  return { status: 200, body: { action: "WARM", services } };
}

/** POST /windows/cool */
export async function coolWindow(
  deps: Deps,
  body: unknown,
  correlationId: string,
  currentTaskId: string | undefined,
): Promise<Reply> {
  const window = parseWindow(body);
  if (!window) return { status: 400 };

  const pending = await deps.gcp.listTaskIds();
  if (anotherWindowOpen(pending, currentTaskId ?? coolTaskId(window))) {
    const services: ServiceChange[] = [];
    for (const { service } of deps.config.targets) {
      const current = await deps.gcp.getMinInstances(service);
      services.push({ service, from: current, to: current });
    }
    deps.logger.write("INFO", "Kept warm: another window is open", {
      event: "prewarm_kept_warm",
      eventId: window.eventId,
      correlationId,
    });
    return { status: 200, body: { action: "KEPT_WARM", services } };
  }

  const baseline = deps.config.baselineMinInstances;
  const services = await setAll(deps, "COOL", window, correlationId, () => baseline);
  return { status: 200, body: { action: "COOL", services } };
}
