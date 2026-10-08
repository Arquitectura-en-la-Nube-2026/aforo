import type { LoggerService, LogLevel } from "@nestjs/common";
import { getCorrelationStore } from "../../core/correlation/correlation-context";
import { StructuredLogger, type Severity } from "../../core/logging/structured-logger";

export type JsonLogLevel = "debug" | "info" | "warn" | "error";

export interface JsonLoggerOptions {
  /** Lowest level written. Default "info" (LOG_LEVEL in Terraform). */
  level?: JsonLogLevel;
  service?: string;
}

const RANK: Record<Severity, number> = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 };
const LEVEL_SEVERITY: Record<JsonLogLevel, Severity> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};
const SEVERITIES = new Set<string>(Object.keys(RANK));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Nest's LoggerService writing one JSON line per call, for `app.useLogger()`. Every `Logger` in the
 * service then logs like StructuredLogger, with correlationId and userId from the request context.
 *
 * An object message becomes fields: `logger.log({ event: "circuit_state", state: "open" })` gives
 * `jsonPayload.event = "circuit_state"`, the field Cloud Logging queries filter on. A `severity`
 * field in the object overrides the method's (e.g. `logger.log({ severity: "WARNING", ... })`).
 */
export class JsonLogger implements LoggerService {
  private readonly writer: StructuredLogger;
  private readonly minimum: number;

  constructor(options: JsonLoggerOptions = {}) {
    this.writer = new StructuredLogger(
      options.service ?? process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "unknown",
    );
    this.minimum = RANK[LEVEL_SEVERITY[options.level ?? "info"]];
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write("INFO", message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write("WARNING", message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write("ERROR", message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write("CRITICAL", message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write("DEBUG", message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write("DEBUG", message, rest);
  }

  setLogLevels(_levels: LogLevel[]): void {
    // The level comes from the constructor (LOG_LEVEL); Nest's own list is not used.
  }

  private write(severity: Severity, message: unknown, rest: unknown[]): void {
    // Nest passes the Logger's context (its class name) as the last string argument.
    const context = typeof rest.at(-1) === "string" ? (rest.at(-1) as string) : undefined;
    // An Error is an object too, but its useful parts (message, stack) are not own enumerable fields.
    const isFields = isRecord(message) && !(message instanceof Error);
    const fields: Record<string, unknown> = isFields ? { ...message } : {};
    if (typeof fields.severity === "string" && SEVERITIES.has(fields.severity)) {
      severity = fields.severity as Severity;
    }
    delete fields.severity;
    if (RANK[severity] < this.minimum) return;

    if (message instanceof Error) {
      fields.error = message.message;
      fields.stack = message.stack;
    }
    // An Error passed after the message, e.g. logger.error("payment call failed", err).
    const extra = rest.find((value): value is Error => value instanceof Error);
    if (extra) {
      fields.error ??= extra.message;
      fields.stack ??= extra.stack;
    }
    // Nest's error(message, stack, context): keep the stack.
    if (severity === "ERROR" && typeof rest[0] === "string" && rest.length > 1) fields.stack ??= rest[0];

    const text = isFields
      ? String(fields.event ?? context ?? "log")
      : message instanceof Error
        ? message.message
        : String(message);
    const store = getCorrelationStore();
    this.writer.write(severity, text, {
      ...(context ? { context } : {}),
      ...(store?.correlationId ? { correlationId: store.correlationId } : {}),
      ...(store?.userId ? { userId: store.userId } : {}),
      ...fields,
    });
  }
}
