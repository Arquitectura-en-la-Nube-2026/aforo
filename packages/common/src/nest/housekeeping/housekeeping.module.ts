import {
  Controller,
  HttpCode,
  Inject,
  Module,
  Optional,
  Post,
  type DynamicModule,
  type ModuleMetadata,
  type Type,
} from "@nestjs/common";
import { DomainError } from "../../core/errors/domain-error";
import { StructuredLogger } from "../../core/logging/structured-logger";
import { OutboxPublisher } from "../../core/outbox/outbox";

/** Periodic work a service registers, e.g. Inventory expiring overdue reservations. */
export interface HousekeepingSweep {
  readonly name: string;
  run(): Promise<void>;
}

export interface HousekeepingOptions {
  /** Modules that provide **and export** the sweeps (each sweep lives with its domain). */
  imports?: ModuleMetadata["imports"];
  /** Sweep classes to run, resolved from `imports`; they are not instantiated a second time here. */
  sweeps?: Array<Type<HousekeepingSweep>>;
}

export const HOUSEKEEPING_SWEEPS = Symbol("HOUSEKEEPING_SWEEPS");

/**
 * Logic shared by the controller and tests. Every sweep runs even if another fails, then the outbox
 * is flushed (sweeps may write to it). Throws once at the end if anything failed, so Cloud
 * Scheduler records the run as failed.
 */
export async function runHousekeeping(
  sweeps: HousekeepingSweep[],
  publisher: OutboxPublisher | undefined,
  logger: StructuredLogger,
): Promise<void> {
  const failed: string[] = [];
  const step = async (name: string, work: () => Promise<unknown>): Promise<void> => {
    const startedAt = performance.now();
    try {
      const result = await work();
      logger.write("INFO", "housekeeping.step", {
        event: "housekeeping",
        step: name,
        durationMs: Math.round(performance.now() - startedAt),
        ...(typeof result === "number" ? { published: result } : {}),
      });
    } catch (error) {
      failed.push(name);
      logger.write("ERROR", "housekeeping.step_failed", {
        event: "housekeeping",
        step: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  for (const sweep of sweeps) await step(sweep.name, () => sweep.run());
  if (publisher) await step("outbox", () => publisher.flush());
  if (failed.length > 0) throw new DomainError("INTERNAL", `housekeeping failed: ${failed.join(", ")}`);
}

/** POST /internal/v1/housekeeping, every minute from Cloud Scheduler (ADR-0002). Answers 204. */
@Controller("internal/v1/housekeeping")
export class HousekeepingController {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "unknown");

  constructor(
    @Inject(HOUSEKEEPING_SWEEPS) private readonly sweeps: HousekeepingSweep[],
    @Optional() private readonly publisher?: OutboxPublisher,
  ) {}

  @Post()
  @HttpCode(204)
  async run(): Promise<void> {
    await runHousekeeping(this.sweeps, this.publisher, this.logger);
  }
}

@Module({})
export class HousekeepingModule {
  static forRoot(options: HousekeepingOptions = {}): DynamicModule {
    const sweeps = options.sweeps ?? [];
    return {
      module: HousekeepingModule,
      imports: options.imports ?? [],
      controllers: [HousekeepingController],
      providers: [
        // Only injected, never re-provided: a second instance here could not resolve the sweep's
        // dependencies, which live in its own module.
        {
          provide: HOUSEKEEPING_SWEEPS,
          inject: sweeps,
          useFactory: (...instances: HousekeepingSweep[]) => instances,
        },
      ],
    };
  }
}
