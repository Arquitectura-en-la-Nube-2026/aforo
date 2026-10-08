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
    const serialized = JSON.stringify({
      severity,
      message,
      service: this.service,
      ...fields,
    });

    if (severity === "ERROR" || severity === "CRITICAL") {
      process.stderr.write(`${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  }
}
