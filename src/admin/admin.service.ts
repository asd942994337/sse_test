import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";

const num = (v: any) => Number(v ?? 0) || 0;

/**
 * 后台的数据查询。
 *
 * 全部是「只读聚合」，没有写操作 —— 管理后台的第一版先把"看清楚"做出来。
 *
 * 性能约定：所有查询都带 `ts >= ?` 且 `ts` 上有索引，
 * 数据量小时不建预聚合表也够；以后 events 上百万行再换成 stats_daily。
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: DbService) {}

  private since(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, Math.min(90, days)));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** props 里的数字字段：JSON 里取出来再转成数值 */
  private jsonNum(path: string): string {
    return `CAST(JSON_UNQUOTE(JSON_EXTRACT(props, '$.${path}')) AS DECIMAL(12,2))`;
  }

  // ---------------------------------------------------------------------------
  //  首页概览
  // ---------------------------------------------------------------------------
  async overview(days = 7) {
    const from = this.since(days);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 按天的 PV / UV
    // 注意两点：
    //   1. 用 DATE_FORMAT 而不是 DATE()：后者被 mysql2 转成 JS Date，
    //      前端 String() 出来是 "Tue Nov 24 2026 …" 这种英文格式
    //   2. GROUP BY 必须和 SELECT 用同一个表达式（按别名分组），
    //      否则 MySQL 的 only_full_group_by 会直接报 1055
    const [trend] = await this.db.db.query<any[]>(
      `SELECT DATE_FORMAT(ts, '%Y-%m-%d') AS day,
              COUNT(*) AS pv,
              COUNT(DISTINCT visitor) AS uv
         FROM events
        WHERE kind = 'page_view' AND ts >= ?
        GROUP BY day
        ORDER BY day`,
      [from]
    );

    // 今天的分项计数
    const [[todayRow]] = await this.db.db.query<any[]>(
      `SELECT
         SUM(kind = 'page_view')  AS pv,
         COUNT(DISTINCT CASE WHEN kind = 'page_view' THEN visitor END) AS uv,
         SUM(kind = 'search')     AS searches,
         SUM(kind = 'chat_ask')   AS chats,
         SUM(kind = 'error')      AS errors
       FROM events WHERE ts >= ?`,
      [today]
    );

    // 搜索词 top（零结果的单独标出来 —— 这是最有价值的埋点）
    const [searches] = await this.db.db.query<any[]>(
      `SELECT target,
              COUNT(*) AS n,
              SUM(COALESCE(${this.jsonNum("n")}, 0) = 0) AS zero
         FROM events
        WHERE kind = 'search' AND ts >= ? AND target <> ''
        GROUP BY target
        ORDER BY n DESC
        LIMIT 15`,
      [from]
    );

    // 热门攻略 / 图鉴
    const [guides] = await this.db.db.query<any[]>(
      `SELECT target, COUNT(*) AS n
         FROM events
        WHERE kind = 'guide_open' AND ts >= ? AND target <> ''
        GROUP BY target
        ORDER BY n DESC
        LIMIT 12`,
      [from]
    );

    // 聊天：次数、平均耗时、平均首字延迟
    const [[chatRow]] = await this.db.db.query<any[]>(
      `SELECT COUNT(*) AS n,
              AVG(${this.jsonNum("ms")})     AS avg_ms,
              AVG(${this.jsonNum("ttfb")})   AS avg_ttfb,
              SUM(COALESCE(${this.jsonNum("usedWeb")}, 0) > 0) AS web_calls
         FROM events
        WHERE kind = 'chat_done' AND ts >= ?`,
      [from]
    );

    // 最近问过什么
    const [questions] = await this.db.db.query<any[]>(
      `SELECT ts, target, props
         FROM events
        WHERE kind = 'chat_ask' AND ts >= ?
        ORDER BY id DESC
        LIMIT 20`,
      [from]
    );

    // 报错聚合
    const [errors] = await this.db.db.query<any[]>(
      `SELECT target, path, COUNT(*) AS n, MAX(ts) AS last_at
         FROM events
        WHERE kind = 'error' AND ts >= ?
        GROUP BY target, path
        ORDER BY n DESC
        LIMIT 12`,
      [from]
    );

    return {
      ok: true,
      days,
      today: {
        pv: num(todayRow?.pv),
        uv: num(todayRow?.uv),
        searches: num(todayRow?.searches),
        chats: num(todayRow?.chats),
        errors: num(todayRow?.errors),
      },
      trend: (trend || []).map((r: any) => ({
        day: String(r.day).slice(0, 10),
        pv: num(r.pv),
        uv: num(r.uv),
      })),
      searches: (searches || []).map((r: any) => ({
        word: r.target,
        n: num(r.n),
        zero: num(r.zero),
      })),
      guides: (guides || []).map((r: any) => ({ target: r.target, n: num(r.n) })),
      chat: {
        n: num(chatRow?.n),
        avgMs: Math.round(num(chatRow?.avg_ms)),
        avgTtfb: Math.round(num(chatRow?.avg_ttfb)),
        webCalls: num(chatRow?.web_calls),
      },
      questions: (questions || []).map((r: any) => ({
        ts: r.ts,
        question: r.target,
        mode: safeJson(r.props)?.mode || "",
        usedWeb: Boolean(safeJson(r.props)?.usedWeb),
      })),
      errors: (errors || []).map((r: any) => ({
        target: r.target,
        path: r.path,
        n: num(r.n),
        lastAt: r.last_at,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  //  事件明细
  // ---------------------------------------------------------------------------
  async events(opts: { kind?: string; limit?: number; offset?: number; days?: number }) {
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
    const offset = Math.max(0, Number(opts.offset) || 0);
    const from = this.since(opts.days || 7);

    const where: string[] = ["ts >= ?"];
    const params: any[] = [from];
    if (opts.kind) {
      where.push("kind = ?");
      params.push(opts.kind);
    }

    const [rows] = await this.db.db.query<any[]>(
      `SELECT id, ts, kind, visitor, user_id, path, target, props
         FROM events
        WHERE ${where.join(" AND ")}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[cnt]] = await this.db.db.query<any[]>(
      `SELECT COUNT(*) AS n FROM events WHERE ${where.join(" AND ")}`,
      params
    );

    return {
      ok: true,
      total: num(cnt?.n),
      limit,
      offset,
      items: (rows || []).map((r: any) => ({
        id: Number(r.id),
        ts: r.ts,
        kind: r.kind,
        visitor: r.visitor,
        userId: r.user_id,
        path: r.path,
        target: r.target,
        props: safeJson(r.props),
      })),
    };
  }

  /** 报表用的「可选事件类型」 */
  kinds() {
    return [
      "page_view",
      "search",
      "guide_open",
      "guide_done",
      "chat_ask",
      "chat_done",
      "api",
      "error",
    ];
  }
}

function safeJson(v: any): any {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
