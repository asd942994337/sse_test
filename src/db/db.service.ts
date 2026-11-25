import { Injectable, OnModuleInit } from "@nestjs/common";
import { Pool, createPool } from "mysql2/promise";

const DB = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "hello",
  password: process.env.DB_PASSWORD || "hellopass",
  database: process.env.DB_NAME || "hello",
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4",
};

@Injectable()
export class DbService implements OnModuleInit {
  pool: Pool | null = null;
  ready = false;
  lastError: string | null = null;

  get db(): Pool {
    if (!this.pool) throw new Error("数据库未就绪");
    return this.pool;
  }

  async onModuleInit() {
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        this.pool = createPool(DB);
        await this.pool.query("SELECT 1");
        await this.migrate();
        await this.seed();
        this.ready = true;
        this.lastError = null;
        console.log(`[db] connected ${DB.host}:${DB.port}/${DB.database} (attempt ${attempt})`);
        return;
      } catch (err: any) {
        this.lastError = err.message;
        console.warn(`[db] 第 ${attempt} 次失败: ${err.code || err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.error("[db] 放弃连接，接口将返回 503");
  }

  private async migrate() {
    const q = (sql: string) => this.db.query(sql);

    await q(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(32) NOT NULL UNIQUE,
        password_hash VARCHAR(200) NOT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await q(`
      CREATE TABLE IF NOT EXISTS sessions (
        token CHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_sessions_user (user_id),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await q(`
      CREATE TABLE IF NOT EXISTS games (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(60) NOT NULL UNIQUE,
        title VARCHAR(120) NOT NULL,
        subtitle VARCHAR(160) NOT NULL DEFAULT '',
        platform VARCHAR(120) NOT NULL DEFAULT '',
        year INT NOT NULL DEFAULT 0,
        accent VARCHAR(20) NOT NULL DEFAULT '#c8102e',
        summary TEXT,
        sort INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await q(`
      CREATE TABLE IF NOT EXISTS guides (
        id INT AUTO_INCREMENT PRIMARY KEY,
        game_id INT NOT NULL,
        slug VARCHAR(40) NOT NULL,
        section VARCHAR(60) NOT NULL,
        title VARCHAR(200) NOT NULL,
        body MEDIUMTEXT NOT NULL,
        tags VARCHAR(200) NOT NULL DEFAULT '',
        kind VARCHAR(20) NOT NULL DEFAULT 'system',
        sort INT NOT NULL DEFAULT 0,
        UNIQUE KEY uniq_game_slug (game_id, slug),
        KEY idx_game_sort (game_id, sort),
        CONSTRAINT fk_guides_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await q(`
      CREATE TABLE IF NOT EXISTS guide_progress (
        user_id INT NOT NULL DEFAULT 1,
        guide_id INT NOT NULL,
        done TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, guide_id),
        KEY idx_gp_guide (guide_id),
        CONSTRAINT fk_progress_guide FOREIGN KEY (guide_id) REFERENCES guides(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await q(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        content VARCHAR(500) NOT NULL,
        done TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 站点配置（模型 key 等）。
    // v 里存的是 AES-256-GCM 密文，密钥来自环境变量 APP_SECRET，不落库。
    // 这样单独拿到数据库（备份、副本、连库排查）是解不开 API Key 的。
    await q(`
      CREATE TABLE IF NOT EXISTS app_settings (
        k VARCHAR(64) PRIMARY KEY,
        v MEDIUMTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 埋点事件（只追加，不更新）。
    // visitor 是匿名访客 ID（前端 cookie 里的 UUID），ip_hash 是 HMAC 后的值 ——
    // 都不含可还原的个人信息，这是埋点该有的底线。
    await q(`
      CREATE TABLE IF NOT EXISTS events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ts DATETIME(3) NOT NULL,
        kind VARCHAR(32) NOT NULL,
        visitor CHAR(32) NOT NULL DEFAULT '',
        user_id INT NULL,
        ip_hash CHAR(64) NULL,
        path VARCHAR(200) NOT NULL DEFAULT '',
        target VARCHAR(200) NOT NULL DEFAULT '',
        props JSON NULL,
        KEY idx_ts (ts),
        KEY idx_kind_ts (kind, ts),
        KEY idx_visitor_ts (visitor, ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }

  private async seed() {
    const { games, guides } = require(`${process.cwd()}/content.js`);
    const kindOf = (section: string) => {
      if (/^支线/.test(section)) return "quest";
      if (/^(地图推进|阶段流程|流程|全流程|幼年篇|成年篇|终局)/.test(section)) return "flow";
      if (/收集/.test(section)) return "collect";
      return "system";
    };

    for (const g of games) {
      await this.db.query(
        `INSERT INTO games (slug,title,subtitle,platform,year,accent,summary,sort)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), subtitle=VALUES(subtitle),
           platform=VALUES(platform), year=VALUES(year), accent=VALUES(accent),
           summary=VALUES(summary), sort=VALUES(sort)`,
        [g.slug, g.title, g.subtitle, g.platform, g.year, g.accent, g.summary, g.sort]
      );
    }

    const [rows] = await this.db.query<any[]>("SELECT id, slug FROM games");
    const idBySlug = new Map<string, number>(rows.map((r: any) => [r.slug, r.id]));

    // 每个游戏实际应该存在的 slug，用来清理改版后残留的旧条目
    const keepByGame = new Map<number, Set<string>>();
    const seen = new Set<string>();
    let updated = 0;

    for (const it of guides) {
      const gameId = idBySlug.get(it.game);
      if (!gameId) continue;

      // key 是稳定 slug（改文案/排序都不会丢进度）；老内容没写 key 时退回 s+sort
      let slug = String(it.key || `s${it.sort}`);
      const seenKey = `${gameId}:${slug}`;
      if (seen.has(seenKey)) {
        console.warn(`[seed] 重复 key ${seenKey}（${it.title}），已加后缀`);
        let n = 2;
        while (seen.has(`${gameId}:${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      seen.add(`${gameId}:${slug}`);

      await this.db.query(
        `INSERT INTO guides (game_id,slug,section,title,body,tags,kind,sort)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE section=VALUES(section), title=VALUES(title),
           body=VALUES(body), tags=VALUES(tags), kind=VALUES(kind), sort=VALUES(sort)`,
        [
          gameId,
          slug,
          it.section,
          it.title,
          it.body,
          it.tags || "",
          it.kind || kindOf(it.section),
          it.sort,
        ]
      );
      updated++;

      if (!keepByGame.has(gameId)) keepByGame.set(gameId, new Set());
      keepByGame.get(gameId)!.add(slug);
    }

    // 按游戏清理「内容表里已经不存在的 slug」：旧版本改编号留下的孤儿条目
    let removed = 0;
    for (const [gameId, keep] of keepByGame) {
      const [existing] = await this.db.query<any[]>(
        "SELECT id, slug FROM guides WHERE game_id = ?",
        [gameId]
      );
      const stale = existing.filter((r: any) => !keep.has(r.slug)).map((r: any) => r.id);
      for (let i = 0; i < stale.length; i += 200) {
        const chunk = stale.slice(i, i + 200);
        const [res] = await this.db.query<any>("DELETE FROM guides WHERE id IN (?)", [chunk]);
        removed += Number(res?.affectedRows || 0);
      }
    }

    console.log(
      `[seed] ${games.length} 游戏 / ${updated} 条目${removed ? ` / 清理旧条目 ${removed}` : ""}`
    );
  }
}
