import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuthModule } from "../auth/auth.module";
import { KnowledgeService } from "./knowledge.service";
import { WebService } from "./web.service";
import { RagService } from "./rag.service";
import { RagController } from "./rag.controller";
import { SettingsService } from "./settings.service";

/**
 * 站内知识库 + 联网搜索 + 流式问答。
 *
 * 依赖 DbModule 拿连接池；数据库没起来时 KnowledgeService 会自动退回 content.js，
 * 所以这个模块在「刚 clone 下来还没起 MySQL」的情况下也能跑。
 *
 * 依赖 AuthModule 是为了给 POST /chat 做登录校验 —— 聊天接口不校验的话，
 * 页面加锁也挡不住直接 curl。
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [RagController],
  providers: [KnowledgeService, WebService, RagService, SettingsService],
})
export class RagModule {}
