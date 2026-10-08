/**
 * Single import point for the framework-agnostic core of @aforo/common (owner: Juan Jose). Only the
 * core: no Nest, so the cold start stays small.
 *
 * createLogger adapts the handler's `log({ severity?, event, ... })` calls onto StructuredLogger,
 * the same JSON writer the other functions use, so each entry is one line with its fields at the
 * top level (`jsonPayload.event`, `jsonPayload.correlationId`).
 */
import { StructuredLogger, type Severity } from '@aforo/common';

export interface Logger {
  log(entry: Record<string, unknown>): void;
}

const RANK: Record<Severity, number> = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 };
const LEVELS: Record<string, Severity> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  warning: 'WARNING',
  error: 'ERROR',
};

export function createLogger(options: { level?: string } = {}): Logger {
  const writer = new StructuredLogger(process.env.K_SERVICE ?? 'mock-payment-gateway');
  const minimum = RANK[LEVELS[(options.level ?? 'info').toLowerCase()] ?? 'INFO'];
  return {
    log(entry) {
      const { severity: raw, ...fields } = entry;
      const severity: Severity =
        typeof raw === 'string' && raw in RANK ? (raw as Severity) : 'INFO';
      if (RANK[severity] < minimum) return;
      writer.write(severity, String(fields.event ?? 'log'), fields);
    },
  };
}
