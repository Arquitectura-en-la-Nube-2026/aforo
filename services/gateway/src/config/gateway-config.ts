export interface GatewayConfig {
  port: number;
  authSecret: string;
  authIssuer: string;
  frontendOrigin: string;
}

export function loadGatewayConfig(env = process.env): GatewayConfig {
  const authSecret = env.AUTH_SECRET?.trim();
  if (!authSecret || Buffer.byteLength(authSecret, "utf8") < 32 || authSecret === "change-me") {
    throw new Error("AUTH_SECRET must be configured with at least 32 bytes");
  }

  const authIssuer = env.AUTH_ISSUER?.trim();
  const frontendOrigin = env.FRONTEND_ORIGIN?.trim();
  if (!authIssuer || !URL.canParse(authIssuer)) throw new Error("AUTH_ISSUER must be a valid URL");
  if (!frontendOrigin || !URL.canParse(frontendOrigin) || new URL(frontendOrigin).origin !== frontendOrigin) {
    throw new Error("FRONTEND_ORIGIN must be a valid URL");
  }

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");

  return { port, authSecret, authIssuer, frontendOrigin };
}
