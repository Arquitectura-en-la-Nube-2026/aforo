import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  CorrelationMiddleware,
  HealthModule,
  ProblemJsonFilter,
  RequestLoggingMiddleware,
  ShutdownModule,
} from "@aforo/common/nest";
import { loadQueueConfig } from "./config/queue-config";
import { EventsController } from "./messaging/events.controller";
import { ProjectionService } from "./messaging/projection.service";
import { RedisInboxStore } from "./messaging/redis-inbox.store";
import { AdmissionService } from "./queue/admission.service";
import { QueueController } from "./queue/queue.controller";
import { QueueService } from "./queue/queue.service";
import { QueueStreamService } from "./queue/queue-stream.service";
import { QUEUE_CONFIG, RedisService } from "./redis/redis.service";

const config = loadQueueConfig();

@Module({
  imports: [HealthModule, ShutdownModule],
  controllers: [QueueController, EventsController],
  providers: [
    { provide: QUEUE_CONFIG, useValue: config },
    { provide: APP_FILTER, useClass: ProblemJsonFilter },
    RedisService,
    ProjectionService,
    RedisInboxStore,
    QueueService,
    QueueStreamService,
    AdmissionService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, RequestLoggingMiddleware).forRoutes("*");
  }
}
