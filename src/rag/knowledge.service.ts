import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";

/** 检索命中的一条 */
export interface KnowledgeHit {
  /** 来源标识：db / content.js */
  from: "db" | "content";
  game: string;
  section: string;
  title: string;
  kind: string;
  /** 命中片段（已经围绕关键词截断好，直接给模型看） */
  snippet: string;
  /** 命中正文的完整内容（本地资料可以给全） */
  body: string;
  /** 相关度打分，用来判断「本地的够不够」 */
  score: number;
  /** 命中的词，方便前端高亮 */
  terms: string[];
}

/**
 * 本地知识库检索。
 *
 * 两套数据源：
 *   1. MySQL（生产环境的主路径）—— games / guides 表
 *   2. content.js（兜底）—— 数据库没起来时直接从内容文件读，保证功能不瘫
 *
 * 为什么不用 FULLTEXT：
 *   MySQL 默认分词器切不了中文，得 `WITH PARSER ngram` 并额外建索引。
 *   这里先用 LIKE + 自研打分：对几百条攻略来说完全够用，而且不改你的表结构。
 *   条目上到几千条以后再换 ngram 全文索引，接口不用动（见 README）。
 */
@Injectable()
export class KnowledgeService {
  private readonly log = new Logger(KnowledgeService.name);
  private contentCache: any[] | null = null;
  private contentAt = 0;

  constructor(private readonly db: DbService) {}

  /**
   * 检索。
   * @param query 用户问题
   * @param limit 最多返回几条
   */
  async search(query: string, limit = 6): Promise<KnowledgeHit[]> {
    const terms = extractTerms(query);
    if (!terms.length) return [];

    // 优先走 MySQL；没就绪就走内容文件
    if (this.db.ready) {
      try {
        return await this.searchDb(terms, limit);
      } catch (err: any) {
        this.log.warn(`数据库检索失败，改用 content.js：${err.message}`);
      }
    }
    return this.searchContent(terms, limit);
  }

  // -------------------------------------------------------------------------
  //  MySQL
  // -------------------------------------------------------------------------
  private async searchDb(terms: string[], limit: number): Promise<KnowledgeHit[]> {
    // 一条 SQL 把候选捞出来：每个词在 title/body/tags 里任一命中即可
    const like = terms.map(() => "(gu.title LIKE ? OR gu.body LIKE ? OR gu.tags LIKE ?)").join(" OR ");
    const params: string[] = [];
    for (const t of terms) {
      const p = `%${t}%`;
      params.push(p, p, p);
    }

    const [rows] = await this.db.db.query<any[]>(
      `SELECT gu.id, gu.section, gu.title, gu.body, gu.tags, gu.kind,
              g.title AS gameTitle, g.slug AS gameSlug
         FROM guides gu
         JOIN games g ON g.id = gu.game_id
        WHERE ${like}
        LIMIT 200`,
      params
    );

    return rows
      .map((r) =>
        toHit(
          "db",
          {
            // 用游戏标题而不是 slug 参与打分 —— 用户问的是「影之刃零」，不是「pbz」
            game: r.gameTitle || r.gameSlug,
            section: r.section,
            title: r.title,
            kind: r.kind,
            body: r.body || "",
            tags: r.tags || "",
          },
          terms
        )
      )
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // -------------------------------------------------------------------------
  //  content.js 兜底
  // -------------------------------------------------------------------------
  private searchContent(terms: string[], limit: number): KnowledgeHit[] {
    const rows = this.loadContent();
    const hits: KnowledgeHit[] = [];
    for (const it of rows) {
      const hit = toHit(
        "content",
        { game: it.game, section: it.section, title: it.title, kind: it.kind || "", body: it.body || "", tags: it.tags || "" },
        terms
      );
      if (hit.score > 0) hits.push(hit);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private loadContent(): any[] {
    // 内容文件随部署走，改动不频繁，缓存 30 秒足够
    if (this.contentCache && Date.now() - this.contentAt < 30_000) return this.contentCache;
    try {
      const { games, guides } = require(`${process.cwd()}/content.js`);
      const titleBySlug = new Map<string, string>((games || []).map((g: any) => [g.slug, g.title]));
      this.contentCache = (guides || []).map((it: any) => ({
        ...it,
        game: titleBySlug.get(it.game) || it.game,
      }));
      this.contentAt = Date.now();
      this.log.log(`[content.js] 载入 ${this.contentCache!.length} 条（数据库不可用时的兜底）`);
    } catch (err: any) {
      this.log.error(`[content.js] 读取失败：${err.message}`);
      this.contentCache = [];
    }
    return this.contentCache!;
  }

  /** 知识库规模，用来在界面上显示「已接入 N 条」 */
  async stats() {
    if (this.db.ready) {
      try {
        const [[a]] = await this.db.db.query<any[]>("SELECT COUNT(*) n FROM guides");
        const [[b]] = await this.db.db.query<any[]>("SELECT COUNT(*) n FROM games");
        return { source: "mysql", guides: Number(a.n), games: Number(b.n) };
      } catch {
        /* 落到下面 */
      }
    }
    const rows = this.loadContent();
    return { source: "content.js", guides: rows.length, games: new Set(rows.map((r) => r.game)).size };
  }
}

// ===========================================================================
//  分词与打分
// ===========================================================================

/** 问句里的虚词，留着只会拉低区分度 */
const STOP = new Set([
  "什么", "怎么", "如何", "哪些", "哪个", "为什么", "请问", "一下", "可以", "是否",
  "这个", "那个", "我们", "你们", "告诉", "介绍", "说说", "知道", "有没有", "多少",
]);

/**
 * 把问题拆成检索词。
 *
 * 中文没有空格，这里用 bigram（"火纹角色" → 火纹 / 纹角 / 角色）近似分词，
 * 比整句 LIKE 更能召回换过措辞的段落。
 */
export function extractTerms(query: string): string[] {
  const raw = String(query || "").toLowerCase();
  const out: string[] = [];
  const push = (t: string) => {
    const s = t.trim();
    if (s.length >= 2 && !STOP.has(s) && !out.includes(s)) out.push(s);
  };

  // 按标点和空格切
  for (const part of raw.split(/[\s,，。．.、;；:：!！?？"'“”‘’()（）\[\]【】]+/)) {
    if (!part) continue;
    if (/^[a-z0-9_\-]+$/i.test(part)) {
      push(part); // 英文/数字词整个保留
      continue;
    }
    push(part); // 整段先留一个
    const cjk = part.replace(/[^\u4e00-\u9fff]/g, "");
    if (cjk.length > 2) {
      for (let i = 0; i + 1 < cjk.length && out.length < 10; i++) push(cjk.slice(i, i + 2));
    }
  }

  // 「第一章」→「01」：攻略的分区名是 "01 悲泣溪谷" 这种数字前缀，
  // 不做这个映射的话，「第一章」在正文字面里根本找不到。
  for (const m of raw.matchAll(/第([一二三四五六七八九十百]+)(?:章|回|节|篇|部)/g)) {
    const n = cnNumber(m[1]);
    if (n > 0) {
      push(String(n).padStart(2, "0"));
      push(String(n));
    }
  }

  return out.slice(0, 12);
}

/** 中文数字 → 阿拉伯数字（够用到 99） */
function cnNumber(s: string): number {
  const digit: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (s === "十") return 10;
  if (s.length === 1) return digit[s] || 0;
  if (s.startsWith("十")) return 10 + (digit[s[1]] || 0);
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    return (digit[a] || 0) * 10 + (b ? digit[b] || 0 : 0);
  }
  if (s === "百") return 100;
  return 0;
}

/**
 * 打分 + 生成片段。
 *
 * 权重：游戏名 > 标题 > 标签 > 分区 > 正文。
 *
 * ★ 游戏名必须算分，而且要最重。
 *   实测踩过的坑：问「影之刃零 第一章」，如果只按标题/正文打分，
 *   空气里全是「第一」「一章」这种通用 bigram，结果全是火纹的条目。
 *   把 game 字段纳入并按最高权重算，才能把范围锁到对的游戏上。
 */
function toHit(
  from: "db" | "content",
  row: { game: string; section: string; title: string; kind: string; body: string; tags: string },
  terms: string[]
): KnowledgeHit {
  const game = row.game || "";
  const section = row.section || "";
  const title = row.title || "";
  const tags = row.tags || "";
  const body = row.body || "";

  const gameL = game.toLowerCase();
  const sectionL = section.toLowerCase();
  const titleL = title.toLowerCase();
  const tagsL = tags.toLowerCase();
  const bodyL = body.toLowerCase();

  let score = 0;
  const matched: string[] = [];

  // ★ 游戏名只给一次固定加分，不能按词累加。
  //   累加会把同一个游戏的所有条目拉到同一个高分（实测全是 37 分），
  //   同游戏内谁更相关就完全看不出来了。
  if (terms.some((t) => gameL.includes(t))) {
    score += 8;
    matched.push("游戏");
  }

  for (const t of terms) {
    let s = 0;
    if (titleL.includes(t)) s += 5;
    if (tagsL.includes(t)) s += 3;
    if (sectionL.includes(t)) s += 2;
    if (bodyL.includes(t)) {
      // 正文里出现的次数也算，但封顶，避免长文档靠啰嗦刷分
      const c = Math.min(bodyL.split(t).length - 1, 4);
      s += 1 + c * 0.3;
    }
    if (s > 0) {
      matched.push(t);
      score += s;
    }
  }

  return {
    from,
    game: row.game,
    section: row.section,
    title,
    kind: row.kind,
    body,
    snippet: makeSnippet(body, matched),
    score: Math.round(score * 100) / 100,
    terms: matched,
  };
}

/** 围绕第一个命中的词截一段，给模型和前端都看这段就够 */
function makeSnippet(body: string, terms: string[], radius = 160): string {
  const text = String(body || "");
  if (!text) return "";
  const lower = text.toLowerCase();

  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0) {
      at = i;
      break;
    }
  }
  if (at < 0) return text.slice(0, radius * 2).replace(/\s+/g, " ");

  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}
