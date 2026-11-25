import { Injectable, Logger } from "@nestjs/common";
import { getRuntime, maskKey } from "./rag.config";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";

/**
 * 搜索源配置。每次现读，界面上改完立刻生效。
 *
 * ★ 首选 DeepSeek 官方的网页搜索：POST /v1/tools/search
 *   好处是**和模型用同一把 key、同一个 base_url**，不用再注册别的服务；
 *   而且它返回的 summary（600~800 字）本来就是给模型读的，
 *   rerank_score / authority 也是现成的质量信号 —— 比抓页面强一个量级。
 *
 * 其余选项：
 *   SEARCH_PROVIDER=tavily / brave / serper   （要各自注册、各自的 key）
 *   留空 → 抓搜索引擎页面（会被限流，只作兜底）
 */
function searchCfg() {
  const rt = getRuntime() || {};

  // 模型的 key / 地址：DeepSeek 官方搜索要用同一把
  const llmKey = String(rt.apiKey !== undefined ? rt.apiKey : process.env.LLM_API_KEY || "").trim();
  const llmBase = String(rt.baseUrl || process.env.LLM_BASE_URL || "https://api.deepseek.com/v1")
    .trim()
    .replace(/\/+$/, "");

  let provider = String(
    rt.searchProvider !== undefined ? rt.searchProvider : process.env.SEARCH_PROVIDER || ""
  )
    .trim()
    .toLowerCase();

  let apiKey = String(rt.searchKey !== undefined ? rt.searchKey : process.env.SEARCH_API_KEY || "").trim();

  // ★ 默认行为：用 DeepSeek 官方 API 的人，不选搜索源就自动用官方网页搜索。
  //   同一把 key、同一个 base_url，不需要任何额外配置。
  if (!provider && llmKey && /deepseek\.com/i.test(llmBase)) {
    provider = "deepseek";
  }

  // 官方搜索复用模型的 key，用户不用填第二遍
  if (!apiKey && (provider === "deepseek" || !provider)) apiKey = llmKey;

  // 便于内网代理 / 本地联调
  const override = (process.env.SEARCH_BASE_URL || "").trim().replace(/\/+$/, "");

  return { provider, apiKey, llmBase, override };
}

/** 各家的接口路径 */
const SEARCH_ENDPOINT: Record<string, string> = {
  deepseek: "/tools/search",
  tavily: "/search",
  brave: "/res/v1/web/search",
  serper: "/search",
};

/** 各家的默认主机（deepseek 用模型那套 base_url） */
const SEARCH_HOST: Record<string, string> = {
  tavily: "https://api.tavily.com",
  brave: "https://api.search.brave.com",
  serper: "https://google.serper.dev",
};

export function searchStatus() {
  const { provider, apiKey } = searchCfg();
  return {
    provider: provider || "scrape",
    hasKey: Boolean(apiKey),
    keyMask: maskKey(apiKey),
    mode: provider && apiKey ? "api" : "scrape",
    supported: Object.keys(SEARCH_ENDPOINT),
  };
}

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  /** 抓取到的正文（可能为空：有些站点拒绝抓取） */
  content: string;
  /** 抓取失败的说明 */
  error?: string;
  /** 搜索源给的质量分（DeepSeek 官方的 rerank_score，0~3） */
  score?: number;
}

/**
 * 联网搜索 + 网页正文抽取。
 *
 * ── 搜索引擎怎么选的（都实测过，2026-11）──
 *
 *   · DuckDuckGo html/lite  → 202 反爬，拿不到结果
 *   · www.bing.com 的 HTML  → 能解析，但返回的是**与查询无关的缓存页**
 *   · Bing RSS（?format=rss）→ 时好时坏；问「时之笛 城堡」直接返回「时」字的字典释义
 *   · 百度                  → 标记天天变，抓到的全是导航
 *   · **搜狗**              → ✅ 稳定、结果精准、链接是真实 URL
 *
 * 所以默认走搜狗，Bing RSS 留作兜底。
 *
 * ★ 另外加了一层「相关性校验」：算出的结果如果和问题一个字都不沾，
 *   就当这个源失败了，换下一个 —— 不然垃圾结果会原样喂给模型，
 *   模型只能说「我没法联网」或者胡说八道。
 *
 * 真要上生产，建议换成付费 API（Tavily / Brave / Serper 等），
 * 只要实现 `search()` 返回 WebHit[]，其它代码都不用动。
 */
@Injectable()
export class WebService {
  private readonly log = new Logger(WebService.name);

  /** 搜索，返回带正文的结果 */
  async search(
    query: string,
    opts: { maxResults?: number; fetchPages?: number; originalQuestion?: string } = {}
  ): Promise<WebHit[]> {
    const maxResults = opts.maxResults ?? 5;
    const fetchPages = opts.fetchPages ?? 3;

    // ── 配了搜索 API 就走 API：稳定的多 ──
    const apiHits = await this.searchViaApi(query, maxResults, opts.originalQuestion);
    if (apiHits.length) {
      const { provider } = searchCfg();

      // 官方搜索会给 rerank_score（0~3，≥1.5 算优质）。有分数就按它排序、丢掉低分的
      const scored = apiHits.filter((h) => typeof h.score !== "number" || h.score >= 1);
      const final = (scored.length ? scored : apiHits)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, maxResults);

      this.log.log(
        `[web] ${provider} API 返回 ${apiHits.length} 条，采用 ${final.length} 条` +
          (typeof final[0]?.score === "number" ? `（最高分 ${final[0].score}）` : "")
      );
      return this.fetchBodies(final, fetchPages);
    }

    // ── 没配（或 API 失败）就退回抓取，尽力而为 ──
    const terms = queryTerms(query);

    const providers: Array<[string, () => Promise<WebHit[]>]> = [
      ["sogou", () => this.searchSogou(query, maxResults)],
      ["bing-rss", () => this.searchBingRss(query, maxResults)],
    ];

    const settled = await Promise.allSettled(providers.map(([, fn]) => fn()));

    const merged: WebHit[] = [];
    const seen = new Set<string>();
    let raw = 0;

    settled.forEach((r, i) => {
      const [name] = providers[i];
      if (r.status === "rejected") {
        this.log.warn(`${name} 请求失败：${r.reason?.message || r.reason}`);
        return;
      }
      const got = r.value || [];
      raw += got.length;

      // 只保留「和问题沾边」的结果：不然垃圾结果会原样喂给模型，
      // 模型只能说「我没法联网」，比不搜还糟
      const relevant = got
        .filter((h) => relevance(h.title + " " + h.snippet, terms) > 0)
        .sort((a, b) => rankScore(b, terms) - rankScore(a, terms));

      for (const h of relevant) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        merged.push(h);
      }
      this.log.log(`[web] ${name}: 拿到 ${got.length} 条，相关 ${relevant.length} 条`);
    });

    if (!merged.length) {
      this.log.warn(`[web] ${raw} 条候选里没有一条和问题相关，本次联网放弃`);
      return [];
    }

    const hits = merged
      .sort((a, b) => rankScore(b, terms) - rankScore(a, terms))
      .slice(0, maxResults);

    this.log.log(`[web] 抓取模式最终采用 ${hits.length} 条`);
    return this.fetchBodies(hits, fetchPages);
  }

  /** 给前 N 条补上正文 */
  private async fetchBodies(hits: WebHit[], fetchPages: number): Promise<WebHit[]> {
    const targets = hits.slice(0, fetchPages).filter((h) => !h.content);
    if (targets.length) {
      const pages = await Promise.all(targets.map((h) => this.fetchPage(h.url)));
      targets.forEach((h, i) => {
        h.content = pages[i].content;
        h.error = pages[i].error;
      });
    }
    return hits.slice(0, fetchPages).concat(hits.slice(fetchPages));
  }

  // ---------------------------------------------------------------------------
  //  付费搜索 API（配了 key 就走这里，比抓取稳得多）
  // ---------------------------------------------------------------------------
  private async searchViaApi(
    query: string,
    count: number,
    originalQuestion?: string
  ): Promise<WebHit[]> {
    const { provider, apiKey, llmBase, override } = searchCfg();
    if (!provider || !apiKey) return [];

    const timeout = AbortSignal.timeout(20_000);
    const host = provider === "deepseek" ? llmBase : SEARCH_HOST[provider];
    if (!host) {
      this.log.warn(`未知的搜索源 ${provider}，回退到抓取模式`);
      return [];
    }
    const url = override ? `${override}${SEARCH_ENDPOINT[provider]}` : `${host}${SEARCH_ENDPOINT[provider]}`;

    try {
      // ── DeepSeek 官方：POST {base}/tools/search ──
      if (provider === "deepseek") {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            query: query.slice(0, 128),
            count,
            ori_question: (originalQuestion || query).slice(0, 128),
            need_content: false,
          }),
          signal: timeout,
        });
        if (!r.ok) throw new Error(`DeepSeek 搜索 ${r.status} ${(await r.text()).slice(0, 150)}`);

        const d: any = await r.json();
        return (d.results || []).map((x: any) => ({
          title: x.title || "",
          url: x.url || "",
          snippet: x.snippet || "",
          // summary 是官方为模型准备的 600~800 字长摘要，比 snippet 适合喂给模型
          content: x.content || x.summary || "",
          score: Number(x.rerank_score) || 0,
        }));
      }

      // ── Tavily：直接返回正文 ──
      if (provider === "tavily") {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, query, max_results: count, include_raw_content: false }),
          signal: timeout,
        });
        if (!r.ok) throw new Error(`Tavily ${r.status} ${(await r.text()).slice(0, 120)}`);
        const d: any = await r.json();
        return (d.results || []).map((x: any) => ({
          title: x.title || "",
          url: x.url || "",
          snippet: String(x.content || "").slice(0, 400),
          content: String(x.content || "").slice(0, 3000),
        }));
      }

      // ── Brave ──
      if (provider === "brave") {
        const r = await fetch(`${url}?q=${encodeURIComponent(query)}&count=${count}`, {
          headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
          signal: timeout,
        });
        if (!r.ok) throw new Error(`Brave ${r.status} ${(await r.text()).slice(0, 120)}`);
        const d: any = await r.json();
        return (d.web?.results || []).map((x: any) => ({
          title: clean(x.title || ""),
          url: x.url || "",
          snippet: clean(x.description || "").slice(0, 400),
          content: "",
        }));
      }

      // ── Serper ──
      if (provider === "serper") {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
          body: JSON.stringify({ q: query, num: count }),
          signal: timeout,
        });
        if (!r.ok) throw new Error(`Serper ${r.status} ${(await r.text()).slice(0, 120)}`);
        const d: any = await r.json();
        return (d.organic || []).map((x: any) => ({
          title: x.title || "",
          url: x.link || "",
          snippet: String(x.snippet || "").slice(0, 400),
          content: "",
        }));
      }

      this.log.warn(`未知的搜索源 ${provider}，回退到抓取模式`);
      return [];
    } catch (err: any) {
      this.log.warn(`搜索 API 失败（${provider}）：${err.message}，回退到抓取模式`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  //  搜狗（主力）
  // ---------------------------------------------------------------------------
  private async searchSogou(query: string, count: number): Promise<WebHit[]> {
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;

    // 搜狗在快速连续查询时会降级成极简页面（几乎没有结果链接），
    // 隔一下再试一次通常就好了
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const hits = parseAnchors(await res.text(), count);
          if (hits.length) return hits;
        }
      } catch {
        /* 走重试 */
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  //  Bing RSS（兜底）
  // ---------------------------------------------------------------------------
  private async searchBingRss(query: string, count: number): Promise<WebHit[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${count}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      return parseRss(await res.text())
        .slice(0, count)
        .map((it) => ({ ...it, content: "" }));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  //  抓网页 + 抽正文
  // ---------------------------------------------------------------------------
  async fetchPage(url: string): Promise<{ content: string; error?: string }> {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { content: "", error: `HTTP ${res.status}` };

      const type = res.headers.get("content-type") || "";
      if (!/text\/html|text\/plain|application\/xml/i.test(type)) {
        return { content: "", error: `不是网页（${type.split(";")[0]}）` };
      }

      // 最多读 512KB，防止大文件把内存和上下文撑爆
      const buf = await res.arrayBuffer();
      const html = new TextDecoder("utf-8").decode(buf.slice(0, 512 * 1024));
      const text = extractMainText(html);

      if (text.length < 80) return { content: "", error: "正文太短（可能是动态渲染页面）" };
      return { content: text.slice(0, 3000) };
    } catch (err: any) {
      const msg = err.name === "TimeoutError" ? "抓取超时" : err.message;
      return { content: "", error: msg };
    }
  }
}

// ===========================================================================
//  纯函数：解析与抽取
// ===========================================================================

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

export function parseRss(xml: string): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = clean((/<title>([\s\S]*?)<\/title>/.exec(b) || [])[1] || "");
    const url = clean((/<link>([\s\S]*?)<\/link>/.exec(b) || [])[1] || "");
    const desc = clean((/<description>([\s\S]*?)<\/description>/.exec(b) || [])[1] || "");
    if (!title || !/^https?:/i.test(url)) continue;
    out.push({ title, url, snippet: desc.slice(0, 200) });
  }
  return out;
}

/** 搜索引擎自己的域名，不是结果 */
const ENGINE_HOST = /(sogou|baidu|bing|so\.com|google|yahoo|duckduckgo)\./i;

/** 页脚里的备案/协议/客服链接，不是搜索结果 */
const JUNK_TITLE =
  /(用户协议|隐私|ICP|备案|营业执照|举报|客服|关于我们|联系方式|招聘|广告服务|意见反馈|版权声明|免责声明|网站地图)/;

/** 明确不该抓的域名 */
const JUNK_HOST = /(miibeian\.gov\.cn|beian\.|\.gov\.cn\/|qq\.com\/document|tencent\.com\/rule)/i;

/**
 * 从搜索结果页里抽「外部链接 + 标题 + 附近文字」。
 *
 * 不依赖具体的 class 名 —— 那些标记几乎每周都在变。
 * 只认 <a href="http...">，再按「和问题是否沾边」排序过滤，
 * 这样即使页面改版也能捞到东西。
 */
export function parseAnchors(html: string, count: number): WebHit[] {
  const out: WebHit[] = [];
  const seen = new Set<string>();

  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{4,160}?)<\/a>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    const url = m[1];
    const title = clean(m[2]);
    if (!title || title.length < 4 || title.length > 120) continue;
    if (ENGINE_HOST.test(url)) continue;
    if (JUNK_HOST.test(url)) continue;
    if (JUNK_TITLE.test(title)) continue;
    if (seen.has(url)) continue;

    // 取这个链接后面 400 个字符当摘要：搜索结果里摘要通常紧跟在标题后面
    const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const snippet = clean(tail).slice(0, 160);

    seen.add(url);
    out.push({ title, url, snippet, content: "" });
    // 多取一些候选：搜索结果页前半部分是导航和广告，真正的结果往往在后面
    if (out.length >= Math.max(30, count * 8)) break;
  }

  return out;
}

// ===========================================================================
//  相关性
// ===========================================================================

/** 问题 → 用来判断「结果沾不沾边」的词 */
export function queryTerms(query: string): string[] {
  const q = String(query || "").toLowerCase();
  const out = new Set<string>();

  for (const w of q.match(/[a-z0-9]{3,}/g) || []) out.add(w);
  for (const run of q.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    // 中文用 bigram；同时把整段也算一个（「时之笛」整体命中权重更高）
    if (run.length <= 6) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/** 结果里命中了几个词 */
export function relevance(text: string, terms: string[]): number {
  const s = String(text || "").toLowerCase();
  let n = 0;
  for (const t of terms) if (s.includes(t)) n++;
  return n;
}

/**
 * 低质量结果的典型特征：下载站、手游预约页、软件库。
 * 它们标题里往往把关键词堆满，光看相关度反而排第一。
 */
const LOW_QUALITY = /(下载|软件库|破解|绿色版|官方正版|手游|预约|版号|安卓版|ios版|破解版)/i;

/** 综合排序分：相关度为主，低质量扣分 */
export function rankScore(hit: { title: string; snippet: string }, terms: string[]): number {
  const base = relevance(hit.title, terms) * 2 + relevance(hit.snippet, terms);
  const penalty = LOW_QUALITY.test(hit.title) ? 3 : 0;
  return base - penalty;
}

const clean = (s: string) =>
  decode(s)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 从 HTML 里抽正文。
 *
 * 不是完整的 readability：先砍掉脚本/样式/导航这些噪音块，
 * 再按「段落密度」挑出正文所在的一块。对付普通文章页够用了。
 */
export function extractMainText(html: string): string {
  let s = html;

  // 1. 砍掉整块噪音
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|iframe|head|nav|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<(script|style|link|meta)[^>]*\/?>/gi, " ");

  // 2. 优先找语义上的正文容器
  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*class="[^"]*(?:content|article|post|entry|markdown|rich_media)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<body[^>]*>([\s\S]*?)<\/body>/i,
  ];
  for (const re of candidates) {
    const m = re.exec(s);
    if (m && stripTags(m[1]).length > 300) {
      s = m[1];
      break;
    }
  }

  const text = stripTags(s);

  // 3. 按行清理：去掉太短的导航残留
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(html: string): string {
  return decode(
    html
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}
