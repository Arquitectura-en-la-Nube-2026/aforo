import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { DomainError } from "../errors/domain-error";
import { envelopeSchema, payloadSchemas } from "./event-schemas.generated";

export type EventType = "EventPublished" | "SalesRulesConfigured" | "ReservationExpired" | "OrderPaid";
export type EventProducer = "catalog" | "inventory" | "orders" | "queue";

/** Wrapper for every message on the bus (contracts/events/envelope.schema.json). */
export interface EventEnvelope<T = unknown> {
  messageId: string;
  type: EventType;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: EventProducer;
  data: T;
}

export interface EventPublishedData {
  eventId: string;
  name: string;
  salesOpensAt: string;
  salesClosesAt: string;
  sectors: Array<{ sectorId: string; name: string; capacity: number; priceCents: number; currency: "COP" }>;
}

export interface SalesRulesConfiguredData {
  eventId: string;
  maxTicketsPerPerson: number;
  reservationTtlSeconds: number;
  openingWindowSeconds: number;
}

export interface ReservationExpiredData {
  reservationId: string;
  eventId: string;
  sectorId: string;
  buyerId: string;
  quantity: number;
  expiredAt: string;
}

export interface OrderPaidData {
  orderId: string;
  reservationId: string;
  paymentId: string;
  eventId: string;
  sectorId: string;
  buyerId: string;
  quantity: number;
  totalCents: number;
  currency: "COP";
  paidAt: string;
}

const MAX_DETAIL_LENGTH = 300;

interface Validators {
  envelope: ValidateFunction;
  payloads: Map<string, ValidateFunction>;
  describe(errors: ValidateFunction["errors"]): string;
}

let cached: Validators | undefined;

// Compiled on first use so a function that imports the package without receiving events pays nothing.
function validators(): Validators {
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  cached = {
    envelope: ajv.compile(envelopeSchema),
    payloads: new Map(Object.entries(payloadSchemas).map(([key, schema]) => [key, ajv.compile(schema)])),
    describe: (errors) => ajv.errorsText(errors).slice(0, MAX_DETAIL_LENGTH),
  };
  return cached;
}

// 400, not 422: a body that is not a valid envelope must dead-letter after the retries
// (contracts/conventions.md), and Pub/Sub only dead-letters on non-2xx.
function malformed(detail: string): DomainError {
  return new DomainError("MALFORMED_REQUEST", detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the body Pub/Sub sends to a push subscription and returns the decoded message data.
 * `message.data` is the base64 of the envelope (PubSubPushRequest in contracts/openapi).
 */
export function decodePushBody(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.message) || typeof body.message.data !== "string") {
    throw malformed("Body is not a Pub/Sub push request");
  }
  try {
    return JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8")) as unknown;
  } catch {
    throw malformed("message.data is not base64 JSON");
  }
}

/**
 * Validates a decoded message as an envelope of the expected type, including its `data` payload.
 * Example: type EventPublished with `data: {}` passes the envelope schema (data is just an object)
 * but fails here, because EventPublished.v1 requires eventId, name, salesOpensAt, ...
 */
export function parseEnvelope<T>(raw: unknown, expectedType: EventType): EventEnvelope<T> {
  const { envelope, payloads, describe } = validators();
  if (!envelope(raw)) throw malformed(`Invalid envelope: ${describe(envelope.errors)}`);
  const message = raw as unknown as EventEnvelope<T>;
  if (message.type !== expectedType) {
    throw malformed(`Expected ${expectedType} but received ${message.type}`);
  }
  const validate = payloads.get(`${message.type}.v${message.version}`);
  if (!validate) throw malformed(`Unsupported ${message.type} version ${message.version}`);
  if (!validate(message.data)) throw malformed(`Invalid ${message.type} data: ${describe(validate.errors)}`);
  return message;
}

/** A Pub/Sub push body to a validated envelope: the one call a push endpoint needs. */
export function parsePushEnvelope<T>(body: unknown, expectedType: EventType): EventEnvelope<T> {
  return parseEnvelope<T>(decodePushBody(body), expectedType);
}
