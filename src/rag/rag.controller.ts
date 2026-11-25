import { Body, Controller, ForbiddenException, Get, Logger, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RagService, RagMode, sessionHeaders } from "./rag.service";
import { KnowledgeService } from "./knowledge.service";
import { WebService } from "./web.service";
import { AuthService } from "../auth/auth.service";

/**
 * 聊天接口。
 *
 * 用 POST + text/event-stream，而不是 EventSource：
 * 聊天要把整段对话放在 body 里，EventSource 只能 GET、带不了 body。
 * 前端用 fetch + ReadableStream 自己解析（见 public/index.html）。
 */
@Controller("api/rag")
export class RagController {
  private readonly log = new Logger(RagController.name);

  constructor(
    private readonly rag: RagService,
    private readonly knowledge: KnowledgeService,
    private readonly web: WebService,
    private readonly auth: AuthService
  ) {}

  /** 前端启动时问一下：模型配了没、知识库多少条 */
  @Get("info")
  async info(@Req() req: Request) {
    const stats = await this.knowledge.stats();
    return { ok: true, ...this.rag.info(), knowledge: stats, canEditConfig: this.canEdit(req) };
  }

  // ---------------------------------------------------------------------------
  //  模型配置（界面上的「⚙」）
  // ---------------------------------------------------------------------------
  @Get("config")
  config() {
    return { ok: true, ...this.rag.info() };
  }

  /**
   * 改配置。
   *
   * ★ 这是要部署到公网的站，所以默认**只允许本机**改：
   *   否则任何访问到你站点的人都能把你的模型换成他自己的。
   *   真要远程管理，设 RAG_ALLOW_CONFIG=1（并且自己加鉴权）。
   */
  @Post("config")
  async apply(@Body() body: any, @Req() req: Request) {
    if (!this.canEdit(req)) {
      throw new ForbiddenException(
        "只允许在本机修改模型配置。要在服务器上远程改，请设置环境变量 RAG_ALLOW_CONFIG=1 并自行加鉴权。"
      );
    }
    const info = await this.rag.applyConfig({
      apiKey: body?.apiKey,
      baseUrl: body?.baseUrl,
      model: body?.model,
      searchProvider: body?.searchProvider,
      searchKey: body?.searchKey,
    });
    this.log.log(
      `配置已更新：模型 ${info.llm.model}（key=${info.llm.keyMask || "未设置"}）` +
        ` / 搜索 ${info.search.provider}（${info.search.mode}）` +
        ` / 存储 ${info.persist.persist}${info.persist.encrypted ? "（加密）" : ""}`
    );
    return { ok: true, ...info };
  }

  /** 测试搜索源：真发一次查询，看看有没有结果 */
  @Post("config/test-search")
  async testSearch(@Body() body: any, @Req() req: Request) {
    if (!this.canEdit(req)) throw new ForbiddenException("只允许在本机测试配置");

    const q = String(body?.query || "影之刃零 攻略").trim();
    const started = Date.now();
    const hits = await this.web.search(q, { maxResults: 5, fetchPages: 2 });
    return {
      ok: hits.length > 0,
      query: q,
      count: hits.length,
      ms: Date.now() - started,
      mode: this.rag.info().search.mode,
      samples: hits.slice(0, 3).map((h) => ({
        title: h.title.slice(0, 60),
        url: h.url,
        fetched: h.content.length,
      })),
      note: hits.length
        ? `搜索正常，返回 ${hits.length} 条（${
            this.rag.info().search.mode === "api" ? "API 模式" : "抓取模式，结果可能不稳定"
          }）`
        : "一条都没搜到：检查 key 是否正确、或换个查询词",
    };
  }

  @Post("config/reset")
  async reset(@Req() req: Request) {
    if (!this.canEdit(req)) throw new ForbiddenException("只允许在本机修改模型配置");
    return { ok: true, ...(await this.rag.resetConfig()) };
  }

  /** 测试连接：真打一次 /models，确认地址和 key 对得上 */
  @Post("config/test")
  async test(@Body() body: any, @Req() req: Request) {
    if (!this.canEdit(req)) throw new ForbiddenException("只允许在本机测试模型配置");

    const cur = this.rag.info();
    const baseUrl = String(body?.baseUrl || cur.llm.baseUrl || "").trim().replace(/\/+$/, "");
    const model = String(body?.model || cur.llm.model || "").trim();

    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: "服务地址必须以 http:// 或 https:// 开头" };

    // 界面上不回填 key，所以没重填时用已保存的那个
    const authKey = String(body?.apiKey || "").trim() || this.rag.currentKeyForTest();
    if (!authKey) return { ok: false, error: "还没有 API Key，请先填一个" };

    const started = Date.now();
    try {
      const r = await fetch(`${baseUrl}/models`, {
        headers: {
          ...(authKey ? { Authorization: `Bearer ${authKey}` } : {}),
          // openCode 需要会话头
          ...sessionHeaders(baseUrl),
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        return {
          ok: false,
          baseUrl,
          status: r.status,
          hint: hintFor(r.status),
          error: detail.slice(0, 200),
          ms: Date.now() - started,
        };
      }
      const json: any = await r.json().catch(() => null);
      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
      const models = list.map((m: any) => m?.id).filter((x: any) => typeof x === "string").slice(0, 60);
      return {
        ok: true,
        baseUrl,
        model,
        models,
        ms: Date.now() - started,
        note: models.length
          ? `地址和 key 都对，网关报告 ${models.length} 个模型`
          : "地址和 key 都对（这个网关没有返回模型列表，不影响使用）",
      };
    } catch (err: any) {
      return { ok: false, baseUrl, error: err.message, ms: Date.now() - started };
    }
  }

  // ---------------------------------------------------------------------------
  //  流式问答
  // ---------------------------------------------------------------------------
  @Post("chat")
  async chat(
    @Body() body: { question?: string; mode?: RagMode; history?: Array<{ role: string; content: string }> },
    @Req() req: Request,
    @Res() res: Response
  ) {
    // ⚠️ 一旦 writeHead 就不能改状态码了，所以校验要放在写头之前
    //
    // ★ 鉴权必须在**接口**上做，光在页面上跳转没用 ——
    //   别人直接 curl 这个地址照样能刷你的 key。
    //   想公开就设 RAG_CHAT_PUBLIC=1，那时务必配配额限流。
    if (process.env.RAG_CHAT_PUBLIC !== "1") {
      const user = await this.auth.currentUser(req).catch(() => null);
      if (!user) {
        res.status(401).json({ ok: false, error: "请先登录后再使用问答" });
        return;
      }
    }

    const question = String(body?.question || "").trim();
    if (!question) {
      res.status(400).json({ ok: false, error: "question 不能为空" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx 反代时必须关掉缓冲，否则前端会「攒一批才收到」
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    // 心跳：代理 60 秒没数据就会断
    const beat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 15_000);

    // 用户点「停止」/ 关页面 → 中断生成
    let aborted = false;
    res.on("close", () => {
      aborted = true;
      clearInterval(beat);
    });

    try {
      for await (const evt of this.rag.stream(question, { mode: body?.mode, history: body?.history })) {
        if (aborted || res.writableEnded) break;
        res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
      }
    } catch (err: any) {
      this.log.error(`聊天失败：${err.message}`);
      if (!aborted && !res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      }
    } finally {
      clearInterval(beat);
      if (!res.writableEnded) res.end();
    }
  }

  // ---------------------------------------------------------------------------
  //  权限：谁能改配置
  // ---------------------------------------------------------------------------
  private canEdit(req?: Request): boolean {
    if (process.env.RAG_ALLOW_CONFIG === "1") return true; // 部署时显式放开

    // ★ 首次配置窗口：服务端还没有任何 API Key 时，允许从任意位置设置一次。
    //   配上之后这个条件立刻不成立，自动收回成「只允许本机」。
    if (!this.rag.info().llm.configured) return true;

    if (!req) return false;

    // 经过 nginx 时 req.socket 是 nginx 容器的地址，真实客户端在 X-Forwarded-For 里
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const peer = req.socket?.remoteAddress || req.ip || "";
    const client = xff || peer;

    if (isLoopback(client)) return true;

    // ⚠️ Docker 端口映射下，宿主机上 `curl 127.0.0.1:8080` 在容器里看到的是
    //    docker 网关地址（172.17.0.1），不是 127.0.0.1。
    //    所以再加一条：对端是私网、客户端也是私网，视为「本机/内网」。
    //    公网用户经 nginx 进来的 client 会是公网 IP，不会命中这条。
    return isPrivate(peer) && isPrivate(client);
  }
}

function isLoopback(ip: string): boolean {
  const s = String(ip || "").replace(/^::ffff:/, "");
  if (!s) return false;
  return s === "::1" || s === "localhost" || s.startsWith("127.");
}

/** 私有地址段：10/8、172.16/12、192.168/16、127/8、IPv6 本地地址 */
function isPrivate(ip: string): boolean {
  const s = String(ip || "").replace(/^::ffff:/, "");
  if (!s) return false;
  if (isLoopback(s)) return true;
  if (s.startsWith("10.") || s.startsWith("192.168.")) return true;
  const m = /^172\.(\d{1,3})\./.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (/^(fe80|fc|fd)/i.test(s)) return true;
  return false;
}

function hintFor(status: number): string {
  if (status === 401) return "API Key 无效或已过期";
  if (status === 402) return "余额不足";
  if (status === 403) return "无权限：该 key 可能没有这个模型的权限";
  if (status === 404) return "地址不对：检查 base_url 是否要带 /v1";
  if (status === 429) return "限流或余额不足";
  return "";
}
