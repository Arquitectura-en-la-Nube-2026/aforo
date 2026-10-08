import type { SalesRules } from "../events/validation";

export interface SeedSector {
  id: string;
  name: string;
  capacity: number;
  priceCents: number;
}

export interface SeedEvent {
  id: string;
  name: string;
  venue: string;
  startsAt: string;
  salesOpensAt: string;
  salesClosesAt: string;
  sectors: SeedSector[];
  rules: SalesRules;
}

/**
 * The three demo events (acceptance step 2). Fixed ids and fixed dates, so every run converges to
 * the same rows and the prewarmer skips them all (windows over, or more than 30 days ahead): the
 * seed never raises min instances. Valid until 2026-11-01 (then the Concierto is within 30 days;
 * from 2026-11-14 the Festival is CLOSED and seed.db.test fails): move the dates if the demo
 * outlives Delivery 4. E-01 publishes its own event through the API (demo runbook).
 */
export const SEED_EVENTS: SeedEvent[] = [
  {
    // The contract's example event: the one whose sale is open during the demo.
    id: "8f1b2c3d-0000-4000-8000-000000000001",
    name: "Festival Estéreo 2026",
    venue: "Parque Simón Bolívar",
    startsAt: "2026-11-14T22:00:00Z",
    salesOpensAt: "2026-10-01T15:00:00Z",
    salesClosesAt: "2026-11-14T20:00:00Z",
    sectors: [
      { id: "a1a1a1a1-0000-4000-8000-000000000001", name: "General", capacity: 200, priceCents: 18_000_000 },
      { id: "a1a1a1a1-0000-4000-8000-000000000002", name: "VIP", capacity: 40, priceCents: 45_000_000 },
      // Small on purpose: SOLD_OUT is easy to show ("fails well").
      { id: "a1a1a1a1-0000-4000-8000-000000000003", name: "Palco", capacity: 6, priceCents: 90_000_000 },
    ],
    rules: { maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: 30 },
  },
  {
    // Sale not open yet: the list shows a SCHEDULED event.
    id: "8f1b2c3d-0000-4000-8000-000000000002",
    name: "Concierto Sinfónico de Fin de Año",
    venue: "Teatro Colón",
    startsAt: "2026-12-31T00:00:00Z",
    salesOpensAt: "2026-12-01T15:00:00Z",
    salesClosesAt: "2026-12-30T20:00:00Z",
    sectors: [
      { id: "a2a2a2a2-0000-4000-8000-000000000001", name: "Platea", capacity: 120, priceCents: 25_000_000 },
      { id: "a2a2a2a2-0000-4000-8000-000000000002", name: "Balcón", capacity: 60, priceCents: 12_000_000 },
    ],
    rules: { maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: 30 },
  },
  {
    // E-02 against dev: one sector of exactly 10 seats. The test's reservations expire after the
    // TTL, which gives the seats back, so the test can run again after it.
    id: "8f1b2c3d-0000-4000-8000-000000000003",
    name: "Noche de Jazz",
    venue: "Teatro Jorge Eliécer Gaitán",
    startsAt: "2026-12-16T01:00:00Z",
    salesOpensAt: "2026-10-01T15:00:00Z",
    salesClosesAt: "2026-12-15T23:00:00Z",
    sectors: [{ id: "a3a3a3a3-0000-4000-8000-000000000001", name: "Mesa", capacity: 10, priceCents: 9_000_000 }],
    rules: { maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: 0 },
  },
];
