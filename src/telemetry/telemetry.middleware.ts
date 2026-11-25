import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TelemetryService } from "./telemetry.service";

/** 高频轮询类接口不记，否则会把真有价值的事件淹掉 */
const IGNORE = new Set([
  "/api/stats",
  "/api/t/event",
  "/api/rag/info",
  "/api/health",
  "/api/ready",
]);

/** 流式接口天然耗时长，不能用「慢请求」的标准衡量 */
const STREAMING = new Set(["/api/rag/chat"]);

/** 经过 nginx 时真实 IP 在 X-Forwarded-For 的第一段 */
export function clientIp(req: Request): string {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket?.remoteAddress || "";
}

/**
 * 自动记录接口层的异常与慢请求。
 *
 * 前端那条线补"人看到什么"（页面、搜索、点开哪条攻略），
 * 这条线负责"服务发生了什么"：哪个接口报 5xx、哪个慢。
 * 缺一条都答不了问题：
 *   · 只有前端 → 不知道接口挂了没有
 *   · 只有后端 → 不知道用户到底点没点
 */
@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const path = req.originalUrl.split("?")[0];

    if (IGNORE.has(path)) return next();

    res.on("finish", () => {
      const ms = Date.now() - startedAt;
      const status = res.statusCode;
      const user = (req as any).user;

      const isError = status >= 400;
      // 只记异常和慢请求：正常的 200 不值钱，全记会把表撑爆
      const isSlow = ms > 1200 && !STREAMING.has(path);
      if (!isError && !isSlow) return;

      this.telemetry.record({
        kind: isError ? "error" : "api",
        userId: user?.id ?? null,
        ip: clientIp(req),
        path,
        target: `${req.method} ${path}`,
        props: { status, ms, method: req.method },
      });
    });

    next();
  }
}
