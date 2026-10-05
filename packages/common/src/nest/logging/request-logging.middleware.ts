import type { NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getCorrelationStore } from "../../core/correlation/correlation-context";
import { StructuredLogger } from "../../core/logging/structured-logger";

export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "unknown");

  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const context = getCorrelationStore();
    const startedAt = performance.now();
    let logged = false;

    const logRequest = (): void => {
      if (logged) return;
      logged = true;
      const status = response.statusCode;
      const queuePass = request.headers["x-queue-pass"];
      this.logger.write(status >= 500 ? "ERROR" : status >= 400 ? "WARNING" : "INFO", "http.request", {
        correlationId: context?.correlationId,
        userId: context?.userId,
        route: request.url?.split("?", 1)[0] ?? "unknown",
        status,
        latencyMs: Math.round(performance.now() - startedAt),
        ...(queuePass ? { queuePass: Array.isArray(queuePass) ? queuePass[0] : queuePass } : {}),
      });
    };

    response.once("finish", logRequest);
    response.once("close", logRequest);
    next();
  }
}
