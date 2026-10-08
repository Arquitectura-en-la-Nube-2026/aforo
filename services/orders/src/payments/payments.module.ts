import { Logger, Module } from '@nestjs/common';
import { ServiceAuthClient } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { JSON_HTTP, JsonHttp } from '../http/http.module';
import { HttpPaymentGateway } from './http-payment-gateway';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { PaymentsRepository } from './payments.repository';
import { buildResilience } from './resilience';

@Module({
  providers: [
    PaymentsRepository,
    {
      provide: PAYMENT_GATEWAY,
      inject: [APP_CONFIG, JSON_HTTP, ServiceAuthClient],
      useFactory: (config: AppConfig, http: JsonHttp, auth: ServiceAuthClient) => {
        const logger = new Logger('PaymentGateway');
        const resilience = buildResilience(config.resilience, { log: (e) => logger.log(e) });
        return new HttpPaymentGateway(config.paymentGatewayUrl, http, (aud) => auth.header(aud), resilience);
      },
    },
  ],
  exports: [PAYMENT_GATEWAY, PaymentsRepository],
})
export class PaymentsModule {}
