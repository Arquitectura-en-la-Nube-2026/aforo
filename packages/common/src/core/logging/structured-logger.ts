export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LogFields {
  service?: string;
  correlationId?: string;
  userId?: string;
  route?: string;
  status?: number;
  latencyMs?: number;
  [key: string]: unknown;
}

export class StructuredLogger {
  constructor(private readonly service: string) {}

  write(severity: Severity, message: string, fields: LogFields = {}): void {
    const serialized = serialize({ severity, message, service: this.service, ...fields });

    if (severity === "ERROR" || severity === "CRITICAL") {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  }
}

/** Logging must never throw into the caller: BigInt and circular fields are written as strings. */
function serialize(line: LogFields & { severity: Severity; message: string }): string {
  try {
    return JSON.stringify(line);
  } catch {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(line, (_key, value: unknown) => {
        if (typeof value === "bigint") return value.toString();
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      });
    } catch (error) {
      return JSON.stringify({
        severity: line.severity,
        message: line.message,
        service: line.service,
        logError: `fields not serializable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
