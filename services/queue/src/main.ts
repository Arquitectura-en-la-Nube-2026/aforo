import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { loadQueueConfig } from "./config/queue-config";

async function bootstrap(): Promise<void> {
  const config = loadQueueConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });

  // SIGTERM: readiness flips to 503, open SSE streams close, then the Redis pool (ShutdownService).
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
