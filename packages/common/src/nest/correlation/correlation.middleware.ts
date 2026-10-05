import type { NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeCorrelationId, runWithCorrelation } from "../../core/correlation/correlation-context";

export class CorrelationMiddleware implements NestMiddleware {
  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const raw = request.headers["x-correlation-id"];
    const correlationId = normalizeCorrelationId(raw);
    response.setHeader("X-Correlation-Id", correlationId);
    runWithCorrelation({ correlationId }, next);
  }
}
