import { Global, Module } from '@nestjs/common';
import { IDEMPOTENCY_REPOSITORY, OUTBOX_STORE, OutboxModule } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { IdempotencyKeyRepository, InboxRepository, OutboxRepository } from './repositories';

@Global()
@Module({
  imports: [
    OutboxModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({ projectId: c.gcpProjectId }),
    }),
  ],
  providers: [
    OutboxRepository,
    InboxRepository,
    IdempotencyKeyRepository,
    { provide: OUTBOX_STORE, useExisting: OutboxRepository },
    { provide: IDEMPOTENCY_REPOSITORY, useExisting: IdempotencyKeyRepository },
  ],
  exports: [OutboxModule, OutboxRepository, InboxRepository, OUTBOX_STORE, IDEMPOTENCY_REPOSITORY],
})
export class MessagingModule {}
