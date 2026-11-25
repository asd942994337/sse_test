import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { TelemetryService } from "./telemetry.service";
import { clientIp } from "./telemetry.middleware";

/**
 * 前端埋点入口。
 *
 * 用 `navigator.sendBeacon()` 发，好处是页面关闭时也能把事件送出去；
 * 所以这里必须快速返回 204，不能做任何耗时操作。
 *
 * 注意：这是**公开接口**（不需要登录），所以：
 *   · 只接受白名单里的事件类型
 *   · 字段全部截断长度
 *   · 不做任何查询，只入队
 */
@Controller("api/t")
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  private static readonly KINDS = new Set([
    "page_view",
    "search",
    "guide_open",
    "guide_done",
    "chat_ask",
    "chat_done",
    "error",
  ]);

  @Post("event")
  event(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    // sendBeacon 发的是 text/plain，body 可能是字符串
    let payload = body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }

    const kind = String(payload?.kind || "");
    if (!TelemetryController.KINDS.has(kind)) {
      res.status(204).end();
      return;
    }

    this.telemetry.record({
      kind: kind as any,
      visitor: payload?.visitor,
      userId: (req as any).user?.id ?? payload?.userId ?? null,
      ip: clientIp(req),
      path: payload?.path,
      target: payload?.target,
      props: payload?.props,
    });

    // 204：没有响应体，sendBeacon 不在乎返回值
    res.status(204).end();
  }
}
