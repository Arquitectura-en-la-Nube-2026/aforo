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
import { loadCatalogConfig } from "./config/catalog-config";
import { CATALOG_CONFIG, DbService } from "./db/db.service";
import { EventsController } from "./events/events.controller";
import { EventsService } from "./events/events.service";
import { StoresModule } from "./messaging/stores";

const config = loadCatalogConfig();

@Global()
@Module({
  imports: [HealthModule],
  providers: [{ provide: CATALOG_CONFIG, useValue: config }, DbService],
  exports: [CATALOG_CONFIG, DbService],
})
class CoreModule {}

@Module({
  imports: [
    CoreModule,
    HealthModule,
    ShutdownModule,
    StoresModule,
    OutboxModule.forRoot({ projectId: config.gcpProjectId }),
    // No sweeps: catalog's housekeeping only flushes what a request could not publish.
    HousekeepingModule.forRoot(),
  ],
  controllers: [EventsController],
  providers: [EventsService, { provide: APP_FILTER, useClass: ProblemJsonFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, RequestLoggingMiddleware).forRoutes("*");
  }
}

export { config };
