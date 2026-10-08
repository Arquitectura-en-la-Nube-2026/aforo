import { Injectable } from "@nestjs/common";

export type HealthCheck = () => Promise<void>;

@Injectable()
export class HealthService {
  private readonly checks = new Map<string, HealthCheck>();

  register(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
  }

  async readiness(): Promise<{ status: "ok" | "error"; checks: Record<string, "ok" | "error"> }> {
    const results = await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            check(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("timeout")), 1500);
            }),
          ]);
          return [name, "ok"] as const;
        } catch {
          return [name, "error"] as const;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
    );
    const checks = Object.fromEntries(results);
    const status = results.every(([, result]) => result === "ok") ? "ok" : "error";
    return { status, checks };
  }
}
