import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as crypto from "node:crypto";
import { DbService } from "../db/db.service";
import { getRuntime, loadFromValues, type RagConfigPatch } from "./rag.config";

/** 配置在数据库里的唯一一行 */
const ROW_KEY = "rag.runtime";

/**
 * 把界面上的模型配置持久化到 MySQL（加密）。
 *
 * ── 为什么存数据库而不是文件 ──
 *   容器每次 `docker compose up --build` 都会重建，容器内的文件全没了；
 *   数据库是独立容器 + 命名卷，数据能活下来。
 *
 * ── 为什么加密 ──
 *   数据库里放明文 API Key 意味着「一次 `mysqldump` 就把 key 泄露了」，
 *   备份文件、只读副本、同事连库排查，全都是泄露面。
 *   这里用 AES-256-GCM 加密，密钥来自环境变量 APP_SECRET（不进数据库）。
 *   这样单独拿到数据库是解不开的。
 *
 * ⚠️ 前提：APP_SECRET 必须稳定且保密。
 *    丢了它，库里那份 key 就再也解不开了（只能重新填）；
 *    泄露它，等于库里的密文失效。
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly log = new Logger(SettingsService.name);
  private available = false;

  constructor(private readonly db: DbService) {}

  // ---------------------------------------------------------------------------
  //  加解密
  // ---------------------------------------------------------------------------
  private aesKey(): Buffer | null {
    const secret = (process.env.APP_SECRET || "").trim();
    if (secret.length < 16) return null;
    // scrypt 把任意长度的口令派生成 32 字节的 AES 密钥
    return crypto.scryptSync(secret, "hello-stack-rag-v1", 32);
  }

  private encrypt(plain: string): string | null {
    const key = this.aesKey();
    if (!key) return null;
    const iv = crypto.randomBytes(12); // GCM 推荐 96 位 IV
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag(); // GCM 自带完整性校验
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }

  private decrypt(payload: string): string | null {
    const key = this.aesKey();
    if (!key) return null;
    const parts = String(payload).split(":");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    try {
      const iv = Buffer.from(parts[1], "base64");
      const tag = Buffer.from(parts[2], "base64");
      const ct = Buffer.from(parts[3], "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag); // 被篡改过会在这里抛错
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch (err: any) {
      this.log.error(`配置解密失败（APP_SECRET 变了？）：${err.message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  //  启动时把库里的配置读回内存
  // ---------------------------------------------------------------------------
  async onModuleInit() {
    if (!this.aesKey()) {
      this.log.warn("没有配置 APP_SECRET，界面配置不会存进数据库（只在内存 + 本地文件）");
    }

    // 数据库可能还没起来（DbService 会重试 60 秒），等一会儿再读
    for (let i = 0; i < 10 && !this.db.ready; i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!this.db.ready) {
      this.log.warn("数据库未就绪，跳过读取已保存的配置");
      return;
    }

    try {
      const [rows] = await this.db.db.query<any[]>(
        "SELECT v FROM app_settings WHERE k = ? LIMIT 1",
        [ROW_KEY]
      );
      this.available = true;
      if (!rows.length) {
        this.log.log("数据库里还没有保存过模型配置");
        return;
      }
      const json = this.decrypt(rows[0].v);
      if (!json) return;

      const saved = JSON.parse(json);
      // 库里的值优先于 .env（用户在界面上改过就以界面为准）
      loadFromValues(saved);
      this.log.log(
        `已从数据库读回配置：模型 ${saved.model || "(默认)"}，` +
          `key=${saved.apiKey ? "已加密保存" : "未设置"}`
      );
    } catch (err: any) {
      this.log.warn(`读取配置失败：${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  //  保存
  // ---------------------------------------------------------------------------
  /** @returns 是否成功写进数据库 */
  async save(): Promise<boolean> {
    if (!this.db.ready) return false;

    const cfg = getRuntime();
    const payload = this.encrypt(JSON.stringify(cfg || {}));
    if (!payload) {
      this.log.warn("没有 APP_SECRET，跳过数据库保存");
      return false;
    }

    try {
      await this.db.db.query(
        `INSERT INTO app_settings (k, v) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE v = VALUES(v)`,
        [ROW_KEY, payload]
      );
      this.available = true;
      return true;
    } catch (err: any) {
      this.log.error(`保存配置到数据库失败：${err.message}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    if (!this.db.ready) return;
    try {
      await this.db.db.query("DELETE FROM app_settings WHERE k = ?", [ROW_KEY]);
    } catch (err: any) {
      this.log.warn(`清除配置失败：${err.message}`);
    }
  }

  /** 给前端看的状态 */
  status() {
    return { persist: this.available ? "mysql" : "memory", encrypted: Boolean(this.aesKey()) };
  }
}

export type { RagConfigPatch };
