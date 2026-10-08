import { DomainError, type FieldError } from "@aforo/common";
import type { CreateReservation } from "./reservations.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = ["eventId", "sectorId", "quantity", "buyerId"];

const invalid = (errors: FieldError[]) =>
  new DomainError("VALIDATION_ERROR", "Request does not match the schema", errors);

export function uuidParam(name: string, value: string): string {
  if (!UUID.test(value)) throw invalid([{ field: name, message: `${name} must be a UUID` }]);
  return value;
}

/** CreateReservationRequest in contracts/openapi/inventory.yaml (additionalProperties: false). */
export function parseCreateReservation(body: unknown): CreateReservation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid([{ field: "body", message: "body must be an object" }]);
  }
  const input = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const field of ["eventId", "sectorId", "buyerId"]) {
    if (typeof input[field] !== "string" || !UUID.test(input[field] as string)) {
      errors.push({ field, message: `${field} must be a UUID` });
    }
  }
  if (!Number.isInteger(input.quantity) || (input.quantity as number) < 1) {
    errors.push({ field: "quantity", message: "quantity must be an integer >= 1" });
  }
  for (const field of Object.keys(input)) {
    if (!CREATE_FIELDS.includes(field)) errors.push({ field, message: "unknown field" });
  }
  if (errors.length > 0) throw invalid(errors);
  return {
    eventId: input.eventId as string,
    sectorId: input.sectorId as string,
    quantity: input.quantity as number,
    buyerId: input.buyerId as string,
  };
}
