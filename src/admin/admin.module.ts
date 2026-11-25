import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DbModule } from "../db/db.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminGuard } from "./admin.guard";

/**
 * 管理后台。
 *
 * 依赖 AuthModule 拿 AuthService（AdminGuard 要用它判断角色），
 * 依赖 TelemetryModule 拿采集队列状态。
 */
@Module({
  imports: [DbModule, AuthModule, TelemetryModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
