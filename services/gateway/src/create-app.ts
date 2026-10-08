import { NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import type { GatewayConfig } from "./config/gateway-config";
import { trustOneProxyHop } from "./trust-proxy";

/** The Gateway app with its Fastify and CORS settings. main.ts starts it; the tests build it the same way. */
export async function createApp(config: GatewayConfig, options: NestApplicationOptions): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: trustOneProxyHop }),
    // rawBody: the payment webhook is forwarded byte for byte (Orders checks an HMAC over it), and
    // Orders' JSON bodies are forwarded as the browser sent them.
    { ...options, rawBody: true },
  );

  app.enableCors({
    origin: config.frontendOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Queue-Pass", "Idempotency-Key", "X-Correlation-Id"],
    // Retry-After is not a CORS-safelisted header: without exposing it, the browser hides it from the
    // frontend and a 429 cannot say how long to wait.
    exposedHeaders: ["X-Correlation-Id", "Retry-After"],
  });
  return app;
}
