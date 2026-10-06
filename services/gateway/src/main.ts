import "reflect-metadata";
import { createApp } from "./create-app";
import { loadGatewayConfig } from "./config/gateway-config";

async function bootstrap(): Promise<void> {
  const config = loadGatewayConfig();
  const app = await createApp(config, { bufferLogs: true });
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
