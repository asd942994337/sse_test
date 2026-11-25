import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";

@Injectable()
export class GuideService {
  constructor(private readonly db: DbService) {}

  async listGames(userId: number) {
    const [rows] = await this.db.db.query<any[]>(
      `SELECT g.slug, g.title, g.subtitle, g.platform, g.year, g.accent, g.summary,
         (SELECT COUNT(*) FROM guides gu WHERE gu.game_id = g.id) AS total,
         (SELECT COUNT(*) FROM guides gu
            JOIN guide_progress p ON p.guide_id = gu.id AND p.done = 1 AND p.user_id = ?
           WHERE gu.game_id = g.id) AS done
       FROM games g
       ORDER BY g.sort`,
      [userId]
    );
    return { ok: true, items: rows };
  }

  async detail(slug: string, userId: number) {
    const [found] = await this.db.db.query<any[]>("SELECT * FROM games WHERE slug = ?", [slug]);
    if (!found.length) return null;
    const game = found[0];

    const [rows] = await this.db.db.query<any[]>(
      `SELECT gu.id, gu.section, gu.title, gu.body, gu.tags, gu.sort, gu.kind,
              COALESCE(p.done, 0) AS done
         FROM guides gu
         LEFT JOIN guide_progress p ON p.guide_id = gu.id AND p.user_id = ?
        WHERE gu.game_id = ?
        ORDER BY gu.sort`,
      [userId, game.id]
    );

    const sections: any[] = [];
    const index = new Map<string, any>();
    for (const r of rows) {
      if (!index.has(r.section)) {
        const s = { name: r.section, kind: r.kind, items: [] };
        index.set(r.section, s);
        sections.push(s);
      }
      index.get(r.section).items.push({
        id: r.id,
        title: r.title,
        body: r.body,
        tags: r.tags,
        kind: r.kind,
        done: r.done,
      });
    }

    return {
      ok: true,
      game,
      sections,
      total: rows.length,
      done: rows.filter((r) => r.done).length,
    };
  }

  async toggle(guideId: number, userId: number, done: boolean) {
    await this.db.db.query(
      `INSERT INTO guide_progress (user_id, guide_id, done) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE done = VALUES(done)`,
      [userId, guideId, done ? 1 : 0]
    );
    return { ok: true, id: guideId, done: done ? 1 : 0 };
  }

  /** 角色图鉴：内容随部署走，不写库 */
  characters() {
    const { characters } = require(`${process.cwd()}/content-fe-chars.js`);
    return { ok: true, total: characters.length, items: characters };
  }

  async search(q: string) {    if (!q) return { ok: true, q, total: 0, items: [] };
    const like = `%${q}%`;
    const [rows] = await this.db.db.query<any[]>(
      `SELECT g.slug AS gameSlug, g.title AS gameTitle, g.accent,
              gu.id, gu.section, gu.title, gu.kind, gu.body
         FROM guides gu JOIN games g ON g.id = gu.game_id
        WHERE gu.title LIKE ? OR gu.body LIKE ? OR gu.tags LIKE ?
        ORDER BY g.sort, gu.sort
        LIMIT 60`,
      [like, like, like]
    );
    return {
      ok: true,
      q,
      total: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        gameSlug: r.gameSlug,
        gameTitle: r.gameTitle,
        accent: r.accent,
        section: r.section,
        kind: r.kind,
        title: r.title,
        snippet: this.snippet(r.body, q),
      })),
    };
  }

  private snippet(body: string, q: string) {
    const i = body.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return body.slice(0, 90).replace(/\s+/g, " ");
    const start = Math.max(0, i - 40);
    const text = body.slice(start, i + q.length + 50).replace(/\s+/g, " ");
    return (start > 0 ? "…" : "") + text + "…";
  }
}
