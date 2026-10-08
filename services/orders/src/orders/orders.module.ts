import { Module } from '@nestjs/common';
import { InventoryClient } from '../inventory-client/inventory.client';
import { PaymentsModule } from '../payments/payments.module';
import { RefundService } from '../payments/refund.service';
import { RefundSweep } from '../payments/refund.sweep';
import { WebhookController } from '../payments/webhook.controller';
import { WebhookService } from '../payments/webhook.service';
import { WebhookSignatureGuard } from '../payments/webhook-signature';
import { ReservationExpiredController } from '../messaging/reservation-expired.controller';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [PaymentsModule],
  controllers: [OrdersController, WebhookController, ReservationExpiredController],
  providers: [
    OrdersRepository,
    OrdersService,
    InventoryClient,
    WebhookService,
    WebhookSignatureGuard,
    RefundService,
    RefundSweep,
  ],
  exports: [RefundSweep],
})
export class OrdersModule {}
