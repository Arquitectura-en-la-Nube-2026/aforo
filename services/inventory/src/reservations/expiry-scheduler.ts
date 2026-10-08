import { HttpClient, MetadataClient, StructuredLogger } from "@aforo/common";
import type { InventoryConfig } from "../config/inventory-config";

export const EXPIRY_SCHEDULER = Symbol("EXPIRY_SCHEDULER");

/** Triggers POST /internal/v1/reservations/{id}/expire at `expiresAt`. Only a trigger: expires_at is the truth. */
export interface ExpiryScheduler {
  schedule(reservationId: string, expiresAt: Date, correlationId: string): Promise<void>;
}

// The service's custom audience (infra/modules/cloud-run-service): valid on every URL of it.
const AUDIENCE = "aforo-inventory";

/**
 * One named Cloud Tasks task per reservation (name = reservationId, so a retry cannot create a
 * second one). The task carries the purchase's X-Correlation-Id, so the expiry and its
 * ReservationExpired event join the purchase in the logs (E-05).
 */
export class CloudTasksExpiryScheduler implements ExpiryScheduler {
  private readonly http = new HttpClient({ connectTimeoutMs: 1000, responseTimeoutMs: 5000 });
  private readonly metadata = new MetadataClient();

  constructor(private readonly config: InventoryConfig) {}

  async schedule(reservationId: string, expiresAt: Date, correlationId: string): Promise<void> {
    const { gcpProjectId, gcpRegion, tasksQueue, selfUrl, tasksInvokerServiceAccount } = this.config;
    const queue = `projects/${gcpProjectId}/locations/${gcpRegion}/queues/${tasksQueue}`;
    const response = await this.http.request({
      method: "POST",
      url: `https://cloudtasks.googleapis.com/v2/${queue}/tasks`,
      headers: { Authorization: `Bearer ${await this.metadata.accessToken()}` },
      body: {
        task: {
          name: `${queue}/tasks/${reservationId}`,
          scheduleTime: expiresAt.toISOString(),
          httpRequest: {
            url: `${selfUrl}/internal/v1/reservations/${reservationId}/expire`,
            httpMethod: "POST",
            headers: { "X-Correlation-Id": correlationId },
            oidcToken: { serviceAccountEmail: tasksInvokerServiceAccount, audience: AUDIENCE },
          },
        },
      },
    });
    if (response.status === 409) return; // ALREADY_EXISTS: this reservation is already scheduled
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Cloud Tasks createTask answered ${response.status}`);
    }
  }
}

/**
 * EXPIRY_SCHEDULER=local only (no Cloud Tasks emulator exists, README): a timer that calls the same
 * endpoint. The one timer outside a request the repo allows, and only on a developer's machine.
 */
export class LocalExpiryScheduler implements ExpiryScheduler {
  private readonly http = new HttpClient();
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "inventory");

  constructor(private readonly selfUrl: string) {}

  async schedule(reservationId: string, expiresAt: Date, correlationId: string): Promise<void> {
    const delay = Math.max(expiresAt.getTime() - Date.now(), 0);
    setTimeout(() => {
      this.http
        .request({
          method: "POST",
          url: `${this.selfUrl}/internal/v1/reservations/${reservationId}/expire`,
          headers: { "X-Correlation-Id": correlationId },
        })
        .catch((error: unknown) =>
          this.logger.write("WARNING", "expiry.local_dispatch_failed", {
            reservationId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }, delay).unref();
  }
}
