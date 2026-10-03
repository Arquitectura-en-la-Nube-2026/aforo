import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { DomainError } from "../../core/errors/domain-error";
import type { ErrorCode } from "../../core/errors/error-code";
import { getCorrelationId } from "../../core/correlation/correlation-context";

interface FastifyRequestShape {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ReplyShape {
  status(code: number): this;
  type(contentType: string): this;
  send(payload: unknown): unknown;
}

interface ErrorShape {
  code?: string;
  message?: string;
}

function isFastifyReply(response: ReplyShape | ServerResponse): response is ReplyShape {
  return typeof (response as ReplyShape).status === "function";
}

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequestShape>();
    const response = http.getResponse<ReplyShape | ServerResponse>();
    const error = exception as ErrorShape;
    const correlationId = getCorrelationId() ?? randomUUID();

    let code: ErrorCode = "INTERNAL";
    let status = 500;
    let title = "Internal server error";
    let detail: string | undefined;
    let errors: DomainError["fieldErrors"];

    if (exception instanceof DomainError) {
      ({ code, status, title, fieldErrors: errors } = exception);
      detail = exception.message;
    } else if (error?.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      code = "MALFORMED_REQUEST";
      status = 400;
      title = "Malformed request";
    } else if (exception instanceof HttpException) {
      const httpStatus = exception.getStatus();
      if (httpStatus === 400) {
        code = "MALFORMED_REQUEST";
        status = 400;
        title = "Malformed request";
      } else if (httpStatus === 404) {
        code = "NOT_FOUND";
        status = 404;
        title = "Resource not found";
      } else if (httpStatus === 401) {
        code = "UNAUTHENTICATED";
        status = 401;
        title = "Authentication required";
      }
      if (status >= 500) this.logger.error(`Unhandled HTTP exception (${request.id ?? "unknown"})`);
    } else {
      this.logger.error(`Unhandled exception (${request.id ?? "unknown"})`);
    }

    const problem = {
      type: `https://aforo.dev/errors/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
      ...(detail ? { detail } : {}),
      correlationId,
      ...(errors?.length ? { errors } : {}),
    };

    if (isFastifyReply(response)) {
      response.status(status).type("application/problem+json").send(problem);
    } else {
      response.statusCode = status;
      response.setHeader("Content-Type", "application/problem+json");
      response.setHeader("X-Correlation-Id", correlationId);
      response.end(JSON.stringify(problem));
    }
  }
}
