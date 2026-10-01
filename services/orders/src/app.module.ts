import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  CorrelationMiddleware,
  HealthModule,
  HousekeepingModule,
  RequestLogInterceptor,
  ShutdownModule,
} from './common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { DbService } from './db/db.service';
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
    HealthModule.forRootAsync({
      inject: [DbService],
      useFactory: (db: DbService) => ({ checks: { database: () => db.ping() } }),
    }),
    OrdersModule,
    HousekeepingModule.forRoot({ imports: [OrdersModule], sweeps: [RefundSweep] }),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
