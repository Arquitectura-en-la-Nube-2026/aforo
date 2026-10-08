import { Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationShutdown } from "@nestjs/common";
import { StructuredLogger } from "../../core/logging/structured-logger";
import { HealthService } from "../health/health.service";

type Hook = () => void | Promise<void>;

/**
 * Graceful shutdown on SIGTERM. Nest closes in this order: beforeApplicationShutdown, then the HTTP
 * server (which waits for in-flight requests), then onApplicationShutdown. So:
 *  - `onDrain` hooks run first. Close SSE streams here: an open stream is an in-flight request, and
 *    the server would wait for it until Cloud Run kills the instance.
 *  - `onClose` hooks run last. Close Redis pools here, after the last request has finished.
 * Readiness answers 503 from the first moment, so the load balancer stops sending new requests.
 * Requires `app.enableShutdownHooks()` in main.ts.
 */
@Injectable()
export class ShutdownService implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new StructuredLogger(process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "unknown");
  private readonly draining: Array<[string, Hook]> = [];
  private readonly closers: Array<[string, Hook]> = [];
  private shuttingDown = false;
  private startedAt = 0;

  constructor(health: HealthService) {
    health.register("shutdown", async () => {
      if (this.shuttingDown) throw new Error("shutting down");
    });
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Runs before the HTTP server stops: close long-lived responses such as SSE streams. */
  onDrain(name: string, hook: Hook): void {
    this.draining.push([name, hook]);
  }

  /** Runs after in-flight requests finished: close pools and clients. */
  onClose(name: string, hook: Hook): void {
    this.closers.push([name, hook]);
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    this.startedAt = performance.now();
    this.logger.write("INFO", "shutdown.begin", { event: "shutdown", phase: "begin", signal });
    await this.run("drain", this.draining);
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    await this.run("close", this.closers);
    this.logger.write("INFO", "shutdown.complete", {
      event: "shutdown",
      phase: "complete",
      signal,
      durationMs: Math.round(performance.now() - this.startedAt),
    });
  }

  // One failing hook must not stop the others: a Redis pool that cannot close should not leave the
  // SSE streams open.
  private async run(phase: string, hooks: Array<[string, Hook]>): Promise<void> {
    for (const [name, hook] of hooks) {
      try {
        await hook();
      } catch (error) {
        this.logger.write("ERROR", "shutdown.hook_failed", {
          event: "shutdown",
          phase,
          hook: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
