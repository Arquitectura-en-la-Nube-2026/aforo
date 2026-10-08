import { Body, Controller, HttpCode, Logger, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { DomainError, getCorrelationId } from '../common';
import { PaymentNotificationDto } from './webhook.dto';
import { WebhookService } from './webhook.service';
import { WebhookSignatureGuard } from './webhook-signature';

@Controller('api/v1/payments')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly service: WebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  @UseGuards(WebhookSignatureGuard)
  async handle(@Body() body: PaymentNotificationDto, @Res({ passthrough: true }) res: Response) {
    const correlationId = getCorrelationId() ?? randomUUID();
    try {
      await this.service.handle(body, correlationId);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'NOT_FOUND') throw err;
      this.logger.error({
        event: 'webhook_failed',
        notificationId: body.notificationId,
        paymentId: body.paymentId,
        code: err instanceof DomainError ? err.code : undefined,
        reason: (err as Error).message,
        stack: (err as Error).stack,
      });
      // Any other failure must be non-2xx so the sender (Cloud Tasks) retries the notification.
      res.status(503).type('application/problem+json');
      return {
        type: 'https://aforo.dev/errors/webhook-processing-failed',
        title: 'Webhook processing failed',
        status: 503,
        code: 'INTERNAL',
        detail: 'The notification could not be processed, retry later',
        correlationId,
      };
    }
  }
}
