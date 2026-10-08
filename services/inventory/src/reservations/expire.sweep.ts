import { Injectable } from "@nestjs/common";
import type { HousekeepingSweep } from "@aforo/common/nest";
import { ReservationsService } from "./reservations.service";

const BATCH = 200;

/**
 * ADR-0003 safety net: every minute, expire what is overdue through the same path as /expire.
 * A lost or early Cloud Tasks task delays an expiry by at most a minute. Housekeeping flushes the
 * outbox after the sweeps, so each expiry here skips its own flush.
 */
@Injectable()
export class ExpireSweep implements HousekeepingSweep {
  readonly name = "expire-overdue";

  constructor(private readonly reservations: ReservationsService) {}

  async run(): Promise<void> {
    for (const id of await this.reservations.overdue(BATCH)) {
      await this.reservations.expire(id, false);
    }
  }
}
