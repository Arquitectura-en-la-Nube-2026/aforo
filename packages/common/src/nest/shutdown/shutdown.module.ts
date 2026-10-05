import { Module } from "@nestjs/common";
import { HealthModule } from "../health/health.module";
import { ShutdownService } from "./shutdown.service";

@Module({ imports: [HealthModule], providers: [ShutdownService], exports: [ShutdownService] })
export class ShutdownModule {}
