import 'reflect-metadata';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainError, JsonLogger, ProblemJsonFilter, installGracefulShutdown } from './common';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new JsonLogger({ level: config.logLevel });

  // rawBody: the webhook HMAC is computed over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(logger);
  app.useGlobalFilters(new ProblemJsonFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new DomainError(
          'VALIDATION_ERROR',
          errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') || 'Invalid request',
        ),
    }),
  );

  // SIGTERM: readiness flips to 503, in-flight requests finish (incl. outbox flush), pools close.
  app.enableShutdownHooks();
  installGracefulShutdown(app, { logger });

  await app.listen(config.port, '0.0.0.0');
  logger.log({ event: 'startup', port: config.port });
}

bootstrap().catch((err) => {
  console.error(JSON.stringify({ severity: 'CRITICAL', event: 'startup_failed', message: err.message }));
  process.exit(1);
});
