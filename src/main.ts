import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AuthService } from "./auth/auth.service";
import * as path from "node:path";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ---------------------------------------------------------------------------
  //  聊天页的访问控制
  // ---------------------------------------------------------------------------
  //  ★ 这一步必须放在 useStaticAssets **之前**：
  //    中间件的注册顺序就是执行顺序，放在后面的话静态文件已经被返回了。
  //
  //  默认要求登录（跟全站一致）。想公开就把 RAG_CHAT_PUBLIC=1 打开，
  //  那时建议同时用配额限流，否则别人能拿你的 key 随便刷。
  const chatPublic = process.env.RAG_CHAT_PUBLIC === "1";
  if (!chatPublic) {
    const auth = app.get(AuthService);
    app.use("/chat", async (req: any, res: any, next: any) => {
      try {
        const user = await auth.currentUser(req);
        if (user) return next();
        res.redirect(302, "/?needLogin=1");
      } catch {
        next();
      }
    });
  }

  // 聊天页：/chat  →  public/index.html
  // 用前缀挂载，避免和已有的 /api、以及将来的根路由打架
  app.useStaticAssets(path.join(process.cwd(), "public"), {
    prefix: "/chat",
    index: "index.html",
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`[nest] listening on http://0.0.0.0:${port}`);
  console.log(`[nest] 聊天页 http://localhost:${port}/chat  （${chatPublic ? "公开" : "需要登录"}）`);
}

bootstrap();
