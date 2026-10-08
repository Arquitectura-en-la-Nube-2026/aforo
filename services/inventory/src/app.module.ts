import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  CorrelationMiddleware,
  HealthModule,
  HousekeepingModule,
  OutboxModule,
  ProblemJsonFilter,
  RequestLoggingMiddleware,
  ShutdownModule,
} from "@aforo/common/nest";
import { loadInventoryConfig, type InventoryConfig } from "./config/inventory-config";
import { DbService, INVENTORY_CONFIG } from "./db/db.service";
import { StoresModule } from "./messaging/stores";
import { AvailabilityController, ProjectionEventsController } from "./projection/projection.controllers";
import { ProjectionService } from "./projection/projection.service";
import { ExpireSweep } from "./reservations/expire.sweep";
import {
  CloudTasksExpiryScheduler,
  EXPIRY_SCHEDULER,
  LocalExpiryScheduler,
  type ExpiryScheduler,
} from "./reservations/expiry-scheduler";
import { ReservationsController } from "./reservations/reservations.controller";
import { ReservationsService } from "./reservations/reservations.service";

const config = loadInventoryConfig();

@Global()
@Module({
  imports: [HealthModule],
  providers: [{ provide: INVENTORY_CONFIG, useValue: config }, DbService],
  exports: [INVENTORY_CONFIG, DbService],
})
class CoreModule {}

@Module({
  controllers: [ReservationsController, AvailabilityController, ProjectionEventsController],
  providers: [
    ReservationsService,
    ProjectionService,
    ExpireSweep,
    {
      provide: EXPIRY_SCHEDULER,
      inject: [INVENTORY_CONFIG],
      useFactory: (c: InventoryConfig): ExpiryScheduler =>
        c.expiryScheduler === "local" ? new LocalExpiryScheduler(c.selfUrl) : new CloudTasksExpiryScheduler(c),
    },
  ],
  exports: [ExpireSweep],
})
class ReservationsModule {}

@Module({
  imports: [
    CoreModule,
    HealthModule,
    ShutdownModule,
    StoresModule,
    OutboxModule.forRoot({ projectId: config.gcpProjectId }),
    ReservationsModule,
    HousekeepingModule.forRoot({ imports: [ReservationsModule], sweeps: [ExpireSweep] }),
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemJsonFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, RequestLoggingMiddleware).forRoutes("*");
  }
}

export { config };
