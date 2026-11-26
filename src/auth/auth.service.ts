import { Injectable } from "@nestjs/common";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { DbService } from "../db/db.service";

export const COOKIE = "sid";
const TTL_DAYS = 30;

export type AuthUser = { id: number; username: string; role: string };

// scrypt 的默认代价参数（N=16384, r=8, p=1）保持不变：
// 库里已有的 hash 就是这套参数算的，改了旧密码就登不进来。
//
// 但必须用**异步**版本。scryptSync 会占住 Node 唯一的主线程，一次校验 ~50ms；
// 几十个并发登录就是「整站排队」——连 /api/health 都跟着卡，
// 压测里 30 并发登录时健康探测从 3ms 涨到 1691ms 就是这个原因。
// 异步版跑在 libuv 线程池里，事件循环照常处理别的请求。
function derive(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${(await derive(password, salt, 64)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = String(stored || "").split(":");
  if (!salt || !hex) return false;
  const candidate = await derive(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function parseCookies(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  async currentUser(req: any): Promise<AuthUser | null> {
    const token = parseCookies(req)[COOKIE];
    if (!token) return null;
    const [rows] = await this.db.db.query<any[]>(
      `SELECT u.id, u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > NOW()`,
      [token]
    );
    return rows[0] || null;
  }

  async createSession(userId: number) {
    const token = randomBytes(32).toString("hex");
    await this.db.db.query(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [token, userId, TTL_DAYS]
    );
    return token;
  }

  cookie(token: string, maxAgeSec: number) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  }
}
