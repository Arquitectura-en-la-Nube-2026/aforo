import { http, type Request, type Response } from "@google-cloud/functions-framework";
import { normalizeCorrelationId, StructuredLogger } from "@aforo/common";
import { loadConfig } from "./config.ts";
import { createGcp, TransientError } from "./gcp.ts";
import { coolWindow, onEventPublished, warmWindow, type Deps, type Reply } from "./handlers.ts";

const logger = new StructuredLogger("prewarmer");
let deps: Deps | undefined;
const getDeps = (): Deps => {
  if (!deps) {
    const config = loadConfig();
    deps = { config, gcp: createGcp(config), logger, now: () => new Date() };
  }
  return deps;
};

// Three routes, one concern (contracts/openapi/prewarmer.yaml). All work finishes before the
// response; delays live in Cloud Tasks.
http("prewarmer", async (req: Request, res: Response) => {
  const correlationId = normalizeCorrelationId(req.header("x-correlation-id"));
  let reply: Reply;
  try {
    if (req.method !== "POST") {
      reply = { status: 405 };
    } else if (req.path === "/events/prewarmer-event-published") {
      reply = await onEventPublished(getDeps(), req.body);
    } else if (req.path === "/windows/warm") {
      reply = await warmWindow(getDeps(), req.body, correlationId);
    } else if (req.path === "/windows/cool") {
      reply = await coolWindow(getDeps(), req.body, correlationId, req.header("x-cloudtasks-taskname"));
    } else {
      reply = { status: 404 };
    }
  } catch (error) {
    // Transient Google API errors -> 503 so Pub/Sub / Cloud Tasks retry; anything else is a bug.
    const transient = error instanceof TransientError;
    logger.write("ERROR", transient ? "Google API unavailable" : "Unexpected error", {
      event: "prewarm_error",
      route: req.path,
      error: (error as Error).message,
      correlationId,
    });
    reply = { status: transient ? 503 : 500 };
  }
  res.status(reply.status);
  if (reply.body === undefined) res.end();
  else res.json(reply.body);
});
