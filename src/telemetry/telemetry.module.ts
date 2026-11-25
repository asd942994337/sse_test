import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { TelemetryService } from "./telemetry.service";
import { TelemetryMiddleware } from "./telemetry.middleware";
import { TelemetryController } from "./telemetry.controller";

/**
 * 埋点：内存队列 + 批量落库。
 *
 * TelemetryService 导出给 AdminService 用（后台要读采集状态）。
 * TelemetryMiddleware 在 AppModule 里全局挂载。
 */
@Module({
  imports: [DbModule],
  controllers: [TelemetryController],
  providers: [TelemetryService, TelemetryMiddleware],
  exports: [TelemetryService],
})
export class TelemetryModule {}
