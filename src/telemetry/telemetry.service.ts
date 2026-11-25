import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as crypto from "node:crypto";
import { DbService } from "../db/db.service";

export type EventKind =
  | "page_view"
  | "search"
  | "guide_open"
  | "guide_done"
  | "chat_ask"
  | "chat_done"
  | "api"
  | "error";

export interface RawEvent {
  kind: EventKind;
  /** 匿名访客 ID（前端 cookie 里的 UUID，不是 IP） */
  visitor?: string;
  userId?: number | null;
  ip?: string;
  path?: string;
  target?: string;
  props?: Record<string, any>;
}

/**
 * 埋点采集。
 *
 * ★ 核心原则：**绝不在请求链路里同步写库**。
 *   每来一个事件就 INSERT 一次，会把接口延迟从 5ms 拖到 15ms，
 *   聊天这种流式接口体验会明显变差。
 *
 *   所以走「内存队列 + 批量落库」：
 *     事件 → 队列 → 每 2 秒 或 攒够 50 条 → 一条多行 INSERT
 *
 *   队列满了丢最老的，宁可少统计几条，不能把服务拖垮。
 */
@Injectable()
export class TelemetryService implements OnModuleDestroy {
  private readonly log = new Logger(TelemetryService.name);
  private queue: any[][] = [];
  private timer: NodeJS.Timeout | null = null;
  private dropped = 0;
  private written = 0;

  private static readonly MAX_QUEUE = 500;
  private static readonly BATCH = 50;
  private static readonly FLUSH_MS = 2000;

  /** 这些路径太平凡，记了只会淹没有用信息 */
  private static readonly IGNORE_PATHS = new Set([
    "/api/stats",
    "/api/t/event",
    "/api/rag/info",
    "/api/health",
    "/api/ready",
  ]);

  constructor(private readonly db: DbService) {
    this.timer = setInterval(() => void this.flush(), TelemetryService.FLUSH_MS);
    // 别让定时器单独把进程挂住
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  /** IP 只存 HMAC，不存原文 —— 统计够用，泄露了也还原不出是谁 */
  hashIp(ip: string): string {
    const secret = (process.env.APP_SECRET || "hello-stack-dev").trim();
    return crypto.createHmac("sha256", secret).update(String(ip || "")).digest("hex");
  }

  /** 入队（同步，极快） */
  record(e: RawEvent) {
    if (!e || !e.kind) return;
    const now = new Date();
    this.queue.push([
      now,
      e.kind,
      String(e.visitor || "").slice(0, 32),
      e.userId ?? null,
      e.ip ? this.hashIp(e.ip) : null,
      String(e.path || "").slice(0, 200),
      String(e.target || "").slice(0, 200),
      e.props ? JSON.stringify(e.props).slice(0, 4000) : null,
    ]);

    if (this.queue.length >= TelemetryService.MAX_QUEUE) {
      this.queue.shift();
      this.dropped += 1;
    }
    if (this.queue.length >= TelemetryService.BATCH) void this.flush();
  }

  /** 批量落库 */
  async flush() {
    if (!this.queue.length || !this.db.ready) return;
    const batch = this.queue.splice(0, TelemetryService.BATCH);

    try {
      await this.db.db.query(
        `INSERT INTO events (ts, kind, visitor, user_id, ip_hash, path, target, props)
         VALUES ?`,
        [batch]
      );
      this.written += batch.length;
    } catch (err: any) {
      // 写失败就丢掉这一批：埋点不能反过来影响主业务
      this.log.warn(`埋点写入失败（丢弃 ${batch.length} 条）：${err.message}`);
    }
  }

  stats() {
    return { queued: this.queue.length, written: this.written, dropped: this.dropped };
  }
}
