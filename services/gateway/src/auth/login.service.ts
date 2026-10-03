import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { v5 as uuidv5 } from "uuid";
import type { GatewayConfig } from "../config/gateway-config";

export interface LoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: { id: string; email: string; displayName: string };
}

const AFORO_USER_NAMESPACE = "d394b39c-c447-5a1f-b3ab-44c4b07be48c";
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

@Injectable()
export class LoginService {
  constructor(
    private readonly jwt: JwtService,
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
  ) {}

  async login(input: { email: string; displayName: string }): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const id = uuidv5(email, AFORO_USER_NAMESPACE);
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAt + TOKEN_TTL_SECONDS;
    const accessToken = await this.jwt.signAsync(
      { email, name: displayName, iat: issuedAt, exp: expiresAtSeconds },
      { algorithm: "HS256", issuer: this.config.authIssuer, subject: id },
    );

    return {
      accessToken,
      tokenType: "Bearer",
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      user: { id, email, displayName },
    };
  }
}
