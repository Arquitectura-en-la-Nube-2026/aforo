import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  CorrelationMiddleware,
  HealthModule,
  HousekeepingModule,
  RequestLoggingMiddleware,
  ShutdownModule,
} from './common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HttpModule } from './http/http.module';
import { MessagingModule } from './messaging/messaging.module';
import { OrdersModule } from './orders/orders.module';
import { RefundSweep } from './payments/refund.sweep';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    HttpModule,
    MessagingModule,
    ShutdownModule,
    HealthModule,
    OrdersModule,
    HousekeepingModule.forRoot({ imports: [OrdersModule], sweeps: [RefundSweep] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, RequestLoggingMiddleware).forRoutes('*');
  }
}
