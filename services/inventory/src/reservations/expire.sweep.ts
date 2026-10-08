import { Injectable } from "@nestjs/common";
import { StructuredLogger, getCorrelationId } from "@aforo/common";
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

  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "inventory");

  constructor(private readonly reservations: ReservationsService) {}

  /** One failed expiry is logged and retried next minute; it must not hold back the rest. */
  async run(): Promise<void> {
    for (const id of await this.reservations.overdue(BATCH)) {
      try {
        await this.reservations.expire(id, false);
      } catch (error) {
        this.logger.write("WARNING", "expiry.sweep_failed", {
          event: "expiry_sweep_failed",
          correlationId: getCorrelationId(),
          reservationId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
