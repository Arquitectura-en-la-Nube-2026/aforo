import { CloudTasksClient } from '@google-cloud/tasks';
import { Config } from './config';

export interface PaymentNotification {
  notificationId: string;
  paymentId: string;
  orderId: string;
  status: 'APPROVED' | 'DECLINED';
  occurredAt: string;
}

/** Delays the webhook without background work: a Cloud Tasks task scheduled at now + N seconds. */
export interface WebhookScheduler {
  schedule(notification: PaymentNotification, correlationId: string): Promise<void>;
}

const ALREADY_EXISTS = 6;

export class CloudTasksWebhookScheduler implements WebhookScheduler {
  private client?: CloudTasksClient;

  constructor(private readonly config: Config) {}

  async schedule(n: PaymentNotification, correlationId: string): Promise<void> {
    this.client ??= new CloudTasksClient();
    const { gcpProjectId, gcpRegion, tasksQueue, selfUrl, tasksInvokerServiceAccount, webhookDelaySeconds } = this.config;
    const parent = this.client.queuePath(gcpProjectId, gcpRegion, tasksQueue);
    try {
      await this.client.createTask({
        parent,
        task: {
          // The task name is the deduplication key: one task per notificationId.
          name: `${parent}/tasks/${n.notificationId}`,
          scheduleTime: { seconds: Math.floor(Date.now() / 1000) + webhookDelaySeconds },
          httpRequest: {
            httpMethod: 'POST',
            url: `${selfUrl}/webhook-dispatch`,
            headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
            body: Buffer.from(JSON.stringify(n)).toString('base64'),
            oidcToken: { serviceAccountEmail: tasksInvokerServiceAccount, audience: selfUrl },
          },
        },
      });
    } catch (err) {
      if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
    }
  }
}
