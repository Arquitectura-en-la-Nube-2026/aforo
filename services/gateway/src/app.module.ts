import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import {
  CorrelationMiddleware,
  HealthModule,
  ProblemJsonFilter,
  RequestLoggingMiddleware,
} from "@aforo/common/nest";
import { DomainError } from "@aforo/common";
import { LoginController } from "./auth/login.controller";
import { LoginService } from "./auth/login.service";
import { SessionAuthGuard } from "./auth/session-auth.guard";
import { loadGatewayConfig } from "./config/gateway-config";

const config = loadGatewayConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: config.authSecret,
      signOptions: { algorithm: "HS256", issuer: config.authIssuer },
    }),
    HealthModule,
  ],
  controllers: [LoginController],
  providers: [
    { provide: "GATEWAY_CONFIG", useValue: config },
    LoginService,
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
