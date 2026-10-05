import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DomainError, setCorrelationUserId } from "@aforo/common";
import { IS_PUBLIC_KEY } from "@aforo/common/nest";
import type { FastifyRequest } from "fastify";
import type { GatewayConfig } from "../config/gateway-config";

interface SessionClaims {
  sub: string;
  email: string;
  name: string;
  iss: string;
  exp: number;
}

type AuthenticatedRequest = FastifyRequest & { user?: SessionClaims };

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject("GATEWAY_CONFIG") private readonly config: GatewayConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new DomainError("UNAUTHENTICATED");

    try {
      const claims = await this.jwt.verifyAsync<SessionClaims>(token, {
        algorithms: ["HS256"],
        issuer: this.config.authIssuer,
      });
      if (!claims.sub || !claims.email || !claims.name) throw new Error("invalid claims");
      request.user = claims;
      setCorrelationUserId(claims.sub);
      return true;
    } catch {
      throw new DomainError("UNAUTHENTICATED");
    }
  }
}
