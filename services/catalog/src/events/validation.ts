import { DomainError, type FieldError } from "@aforo/common";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RFC 3339 date-time (JSON Schema "date-time"); stored and returned in UTC.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const MAX_INT4 = 2_147_483_647;

export type EventStatus = "DRAFT" | "PUBLISHED";

export interface NewSector {
  name: string;
  capacity: number;
  priceCents: number;
}

/** CreateEventRequest in contracts/openapi/catalog.yaml, with its dates parsed. */
export interface NewEvent {
  name: string;
  venue: string;
  startsAt: Date;
  salesOpensAt: Date;
  salesClosesAt: Date;
  sectors: NewSector[];
}

/** SalesRules in contracts/openapi/catalog.yaml. */
export interface SalesRules {
  maxTicketsPerPerson: number;
  reservationTtlSeconds: number;
  openingWindowSeconds: number;
}

export interface ListQuery {
  status?: EventStatus;
  page: number;
  size: number;
}

const invalid = (errors: FieldError[]) =>
  new DomainError("VALIDATION_ERROR", "Request does not match the schema", errors);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function unknownFields(input: Record<string, unknown>, allowed: string[], prefix: string, errors: FieldError[]) {
  for (const field of Object.keys(input)) {
    if (!allowed.includes(field)) errors.push({ field: `${prefix}${field}`, message: "unknown field" });
  }
}

function text(input: Record<string, unknown>, field: string, prefix: string, errors: FieldError[]): string {
  const value = input[field];
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ field: `${prefix}${field}`, message: `${field} must be a non-empty string` });
    return "";
  }
  return value;
}

function integer(
  input: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  prefix: string,
  errors: FieldError[],
): number {
  const value = input[field];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    errors.push({ field: `${prefix}${field}`, message: `${field} must be an integer between ${min} and ${max}` });
    return 0;
  }
  return value as number;
}

/** Date parsing rolls 2026-02-30 over to March 2; a real calendar date keeps its own day. */
function realCalendarDate(value: string): boolean {
  const [year, month, day, hour, minute, second] = value.split(/[-T:.Z+]/i).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
}

function dateTime(input: Record<string, unknown>, field: string, errors: FieldError[]): Date {
  const value = input[field];
  const parsed =
    typeof value === "string" && DATE_TIME.test(value) && realCalendarDate(value) ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    errors.push({ field, message: `${field} must be an ISO-8601 date-time` });
    return new Date(Number.NaN);
  }
  return parsed;
}

export function uuidParam(name: string, value: string): string {
  if (!UUID.test(value)) throw invalid([{ field: name, message: `${name} must be a UUID` }]);
  return value;
}

export function parseCreateEvent(body: unknown): NewEvent {
  if (!isRecord(body)) throw invalid([{ field: "body", message: "body must be an object" }]);
  const errors: FieldError[] = [];
  unknownFields(body, ["name", "venue", "startsAt", "salesOpensAt", "salesClosesAt", "sectors"], "", errors);
  const name = text(body, "name", "", errors);
  const venue = text(body, "venue", "", errors);
  const startsAt = dateTime(body, "startsAt", errors);
  const salesOpensAt = dateTime(body, "salesOpensAt", errors);
  const salesClosesAt = dateTime(body, "salesClosesAt", errors);
  // Not in the schema, but a window that closes before it opens would never be OPEN.
  if (salesOpensAt.getTime() >= salesClosesAt.getTime()) {
    errors.push({ field: "salesClosesAt", message: "salesClosesAt must be after salesOpensAt" });
  }

  const sectors: NewSector[] = [];
  if (!Array.isArray(body.sectors) || body.sectors.length === 0) {
    errors.push({ field: "sectors", message: "sectors must be a non-empty array" });
  } else {
    body.sectors.forEach((sector: unknown, index) => {
      const prefix = `sectors[${index}].`;
      if (!isRecord(sector)) {
        errors.push({ field: `sectors[${index}]`, message: "sector must be an object" });
        return;
      }
      unknownFields(sector, ["name", "capacity", "priceCents"], prefix, errors);
      sectors.push({
        name: text(sector, "name", prefix, errors),
        capacity: integer(sector, "capacity", 1, MAX_INT4, prefix, errors),
        priceCents: integer(sector, "priceCents", 0, Number.MAX_SAFE_INTEGER, prefix, errors),
      });
    });
  }
  if (errors.length > 0) throw invalid(errors);
  return { name, venue, startsAt, salesOpensAt, salesClosesAt, sectors };
}

export function parseSalesRules(body: unknown): SalesRules {
  if (!isRecord(body)) throw invalid([{ field: "body", message: "body must be an object" }]);
  const errors: FieldError[] = [];
  unknownFields(body, ["maxTicketsPerPerson", "reservationTtlSeconds", "openingWindowSeconds"], "", errors);
  const rules = {
    maxTicketsPerPerson: integer(body, "maxTicketsPerPerson", 1, MAX_INT4, "", errors),
    reservationTtlSeconds: integer(body, "reservationTtlSeconds", 30, MAX_INT4, "", errors),
    openingWindowSeconds: integer(body, "openingWindowSeconds", 0, MAX_INT4, "", errors),
  };
  if (errors.length > 0) throw invalid(errors);
  return rules;
}

/** ?status=&page=&size= (Page and Size in contracts/openapi/components/common.yaml). */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const errors: FieldError[] = [];
  const single = (name: string): string | undefined => {
    const value = query[name];
    return Array.isArray(value) ? String(value[0]) : value === undefined ? undefined : String(value);
  };
  const status = single("status");
  if (status !== undefined && status !== "DRAFT" && status !== "PUBLISHED") {
    errors.push({ field: "status", message: "status must be DRAFT or PUBLISHED" });
  }
  const number = (name: string, fallback: number, min: number, max: number): number => {
    const raw = single(name);
    if (raw === undefined) return fallback;
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!(value >= min && value <= max)) {
      errors.push({ field: name, message: `${name} must be an integer between ${min} and ${max}` });
    }
    return value;
  };
  const page = number("page", 0, 0, 1_000_000);
  const size = number("size", 20, 1, 100);
  if (errors.length > 0) throw invalid(errors);
  return { status: status as EventStatus | undefined, page, size };
}
