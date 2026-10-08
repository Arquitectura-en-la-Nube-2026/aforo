import { Global, Module } from '@nestjs/common';
import { HttpClient, ServiceAuthClient } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';

export interface JsonRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Shape we rely on from the @aforo/common HttpClient. */
export interface JsonHttp {
  request<T = any>(req: JsonRequest): Promise<{ status: number; body: T | undefined }>;
}

export const JSON_HTTP = Symbol('JSON_HTTP');

@Global()
@Module({
  providers: [
    {
      provide: ServiceAuthClient,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => new ServiceAuthClient({ mode: c.authMode }),
    },
    {
      provide: JSON_HTTP,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): JsonHttp =>
        new HttpClient({ connectTimeoutMs: c.http.connectTimeoutMs, responseTimeoutMs: c.http.responseTimeoutMs }),
    },
  ],
  exports: [ServiceAuthClient, JSON_HTTP],
})
export class HttpModule {}
