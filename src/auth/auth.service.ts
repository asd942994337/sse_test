import { Injectable } from "@nestjs/common";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { DbService } from "../db/db.service";

export const COOKIE = "sid";
const TTL_DAYS = 30;

export type AuthUser = { id: number; username: string; role: string };

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hex] = String(stored || "").split(":");
  if (!salt || !hex) return false;
  const candidate = scryptSync(password, salt, 64);
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
