import { Module, type DynamicModule, type ModuleMetadata, type Provider } from "@nestjs/common";
import { OutboxPublisher, type OutboxStore, type OutboxTransport } from "../../core/outbox/outbox";
import { PubSubRestTransport } from "../../core/outbox/pubsub-transport";

/** Provide the service's OutboxStore under this token. */
export const OUTBOX_STORE = Symbol("OUTBOX_STORE");
const OUTBOX_OPTIONS = Symbol("OUTBOX_OPTIONS");

export interface OutboxModuleOptions {
  /** GCP project that owns the topics (GCP_PROJECT_ID). */
  projectId: string;
  batchSize?: number;
  maxPerFlush?: number;
  /** Replaces Pub/Sub, e.g. in tests. */
  transport?: OutboxTransport;
}

export interface OutboxModuleAsyncOptions {
  /** Modules providing what `inject` needs, and OUTBOX_STORE unless a global module exports it. */
  imports?: ModuleMetadata["imports"];
  inject?: Array<string | symbol | Function>;
  useFactory: (...args: never[]) => OutboxModuleOptions | Promise<OutboxModuleOptions>;
}

/**
 * Makes OutboxPublisher injectable everywhere (global), built over the service's OUTBOX_STORE.
 * HousekeepingModule picks it up to flush every minute.
 */
@Module({})
export class OutboxModule {
  static forRoot(options: OutboxModuleOptions, imports: ModuleMetadata["imports"] = []): DynamicModule {
    return OutboxModule.build(imports, { provide: OUTBOX_OPTIONS, useValue: options });
  }

  static forRootAsync(options: OutboxModuleAsyncOptions): DynamicModule {
    return OutboxModule.build(options.imports ?? [], {
      provide: OUTBOX_OPTIONS,
      inject: options.inject ?? [],
      useFactory: options.useFactory,
    });
  }

  private static build(imports: ModuleMetadata["imports"], optionsProvider: Provider): DynamicModule {
    return {
      module: OutboxModule,
      global: true,
      imports,
      providers: [
        optionsProvider,
        {
          provide: OutboxPublisher,
          inject: [OUTBOX_STORE, OUTBOX_OPTIONS],
          useFactory: (store: OutboxStore, options: OutboxModuleOptions) =>
            new OutboxPublisher(
              store,
              options.transport ?? new PubSubRestTransport({ projectId: options.projectId }),
              options,
            ),
        },
      ],
      exports: [OutboxPublisher],
    };
  }
}
