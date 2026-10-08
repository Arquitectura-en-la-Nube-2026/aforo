import { buildEnvelope, type EventPublishedData, type SalesRulesConfiguredData } from "@aforo/common";
import type { CatalogConfig } from "../config/catalog-config";
import type { Queryable } from "../db/db.service";
import { addToOutbox } from "../messaging/stores";
import type { Event } from "./event.view";

/** EventPublished v1 (contracts/events/event-published.v1.schema.json). */
export function eventPublishedData(event: Event): EventPublishedData {
  return {
    eventId: event.id,
    name: event.name,
    salesOpensAt: event.salesOpensAt,
    salesClosesAt: event.salesClosesAt,
    sectors: event.sectors.map((sector) => ({
      sectorId: sector.id,
      name: sector.name,
      capacity: sector.capacity,
      priceCents: sector.priceCents,
      currency: sector.currency,
    })),
  };
}

/** SalesRulesConfigured v1; only for an event that has rules. */
export function salesRulesConfiguredData(event: Event): SalesRulesConfiguredData {
  if (!event.salesRules) throw new Error(`event ${event.id} has no sales rules`);
  return { eventId: event.id, ...event.salesRules };
}

type Topics = Pick<CatalogConfig, "topicEventPublished" | "topicSalesRulesConfigured">;

/**
 * Writes the facts of a published event to the outbox, in the caller's transaction. Publishing
 * writes both; a rules change writes only SalesRulesConfigured. Consumers upsert and accept either
 * order (contracts/events/README.md), so re-emitting is always safe (the seed relies on it).
 */
export async function emitFacts(
  q: Queryable,
  topics: Topics,
  event: Event,
  facts: { eventPublished: boolean; salesRulesConfigured: boolean },
): Promise<void> {
  if (facts.eventPublished) {
    await addToOutbox(
      q,
      event.id,
      topics.topicEventPublished,
      buildEnvelope({ type: "EventPublished", producer: "catalog", data: eventPublishedData(event) }),
    );
  }
  if (facts.salesRulesConfigured) {
    await addToOutbox(
      q,
      event.id,
      topics.topicSalesRulesConfigured,
      buildEnvelope({ type: "SalesRulesConfigured", producer: "catalog", data: salesRulesConfiguredData(event) }),
    );
  }
}
