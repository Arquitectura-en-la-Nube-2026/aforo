import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { JsonLogger } from "@aforo/common/nest";
import { AppModule, config } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = new JsonLogger({ level: config.logLevel });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger });

  // SIGTERM (ShutdownModule): readiness flips to 503, in-flight requests finish (including their
  // outbox flush), then the pool closes.
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
  logger.log({ event: "startup", port: config.port });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ severity: "CRITICAL", message: "startup_failed", error: message })}\n`);
  process.exit(1);
});
