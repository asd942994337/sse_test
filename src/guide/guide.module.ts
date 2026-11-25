import { Module } from "@nestjs/common";
import { GuideController } from "./guide.controller";
import { GuideService } from "./guide.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [GuideController],
  providers: [GuideService],
})
export class GuideModule {}
