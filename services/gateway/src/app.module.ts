import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import {
  CorrelationMiddleware,
  HealthModule,
  ProblemJsonFilter,
  RequestLoggingMiddleware,
  ShutdownModule,
} from "@aforo/common/nest";
import { DomainError } from "@aforo/common";
import { LoginController } from "./auth/login.controller";
import { LoginService } from "./auth/login.service";
import { ServiceIdentityService } from "./auth/service-identity.service";
import { SessionAuthGuard } from "./auth/session-auth.guard";
import { loadGatewayConfig } from "./config/gateway-config";
import { QueueProxyController } from "./queue/queue-proxy.controller";
import { QueueProxyService } from "./queue/queue-proxy.service";
import { RateLimitGuard } from "./rate-limit/rate-limit.guard";
import { RateLimitService } from "./rate-limit/rate-limit.service";

const config = loadGatewayConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: config.authSecret,
      signOptions: { algorithm: "HS256", issuer: config.authIssuer },
    }),
    HealthModule,
    ShutdownModule,
  ],
  controllers: [LoginController, QueueProxyController],
  providers: [
    { provide: "GATEWAY_CONFIG", useValue: config },
    LoginService,
    RateLimitService,
    ServiceIdentityService,
    QueueProxyService,
    // Order matters: the quota runs before the session check, so requests with a bad token spend it too.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    SessionAuthGuard,
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
    { provide: APP_FILTER, useClass: ProblemJsonFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (validationErrors) =>
          new DomainError(
            "VALIDATION_ERROR",
            "Request does not match the schema",
            validationErrors.flatMap((error) =>
              Object.values(error.constraints ?? {}).map((message) => ({ field: error.property, message })),
            ),
          ),
      }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, RequestLoggingMiddleware).forRoutes("*");
  }
}
