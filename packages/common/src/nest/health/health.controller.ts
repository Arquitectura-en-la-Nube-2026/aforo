import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @Public()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @Public()
  @HttpCode(HttpStatus.OK)
  async ready(
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<{ status: "ok" | "error"; checks: Record<string, "ok" | "error"> }> {
    const result = await this.health.readiness();
    if (result.status === "error") response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
