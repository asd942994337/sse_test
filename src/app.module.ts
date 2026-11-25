import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { AuthModule } from "./auth/auth.module";
import { GuideModule } from "./guide/guide.module";
import { RagModule } from "./rag/rag.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { AdminModule } from "./admin/admin.module";
import { HealthController } from "./health/health.controller";
import { TelemetryMiddleware } from "./telemetry/telemetry.middleware";

@Module({
  imports: [DbModule, AuthModule, GuideModule, RagModule, TelemetryModule, AdminModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  /** 全局埋点：只记异常和慢请求，正常 200 不记（否则表会被撑爆） */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TelemetryMiddleware).forRoutes("*");
  }
}
