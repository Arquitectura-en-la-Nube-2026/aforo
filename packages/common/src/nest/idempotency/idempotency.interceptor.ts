import {
  Inject,
  Injectable,
  RequestMethod,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { from, mergeMap, of, type Observable } from "rxjs";
import { DomainError } from "../../core/errors/domain-error";
import { idempotencyRequestHash, type IdempotencyRepository } from "../../core/idempotency/idempotency";
import { StructuredLogger } from "../../core/logging/structured-logger";

/** Provide the service's IdempotencyRepository under this token. */
export const IDEMPOTENCY_REPOSITORY = Symbol("IDEMPOTENCY_REPOSITORY");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestShape {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseShape {
  header?(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
}

/**
 * Idempotency-Key on a state-changing route (contracts/conventions.md, RD-02, R-06):
 * - missing or not a UUID → 422 VALIDATION_ERROR (the header is required by the contracts);
 * - first use → runs the handler and stores its status and body;
 * - repeat with the same request → the stored body, with `Idempotent-Replayed: true`;
 * - same key, different request → 409 IDEMPOTENCY_CONFLICT.
 *
 * Only successful responses are stored: a retry after an error runs again. The status replayed is
 * the route's (@HttpCode, else 201 for POST and 200 otherwise), the same one the first call got.
 *
 * This is a cache, not a lock: two concurrent first calls with the same key both run the handler.
 * The business transaction must already be safe under that (unique constraints, conditional
 * updates), as it must be for any retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "unknown");

  constructor(
    @Inject(IDEMPOTENCY_REPOSITORY) private readonly repository: IdempotencyRepository,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestShape>();
    const response = http.getResponse<ResponseShape>();

    const raw = request.headers["idempotency-key"];
    const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!key || !UUID.test(key)) {
      throw new DomainError("VALIDATION_ERROR", "Request does not match the schema", [
        { field: "Idempotency-Key", message: "Idempotency-Key must be a UUID" },
      ]);
    }

    const userId = request.headers["x-user-id"];
    const requestHash = idempotencyRequestHash({
      method: request.method,
      path: (request.originalUrl ?? request.url).split("?", 1)[0],
      userId: Array.isArray(userId) ? userId[0] : userId,
      body: request.body,
    });

    const stored = await this.repository.find(key);
    if (stored) {
      if (stored.requestHash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT");
      setHeader(response, "Idempotent-Replayed", "true");
      return of(stored.responseBody ?? undefined);
    }

    const statusCode =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method.toUpperCase() === RequestMethod[RequestMethod.POST] ? 201 : 200);

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.repository
            .save({ key, requestHash, statusCode, responseBody: body ?? null })
            .catch((error: unknown) => {
              // The work is done and committed: answer it. A retry runs the handler again, which the
              // business rules already make safe.
              this.logger.write("WARNING", "idempotency.save_failed", {
                error: error instanceof Error ? error.message : String(error),
              });
            })
            .then(() => body),
        ),
      ),
    );
  }
}

function setHeader(response: ResponseShape, name: string, value: string): void {
  if (typeof response.header === "function") response.header(name, value);
  else response.setHeader?.(name, value);
}
