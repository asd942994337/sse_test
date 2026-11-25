import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { AuthService, COOKIE, hashPassword, parseCookies, verifyPassword } from "./auth.service";
import { DbService } from "../db/db.service";

@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DbService
  ) {}

  @Get("status")
  async status() {
    const [[row]] = await this.db.db.query<any[]>("SELECT COUNT(*) AS n FROM users");
    return { ok: true, needSetup: row.n === 0 };
  }

  @Post("login")
  async login(@Body() body: any, @Res({ passthrough: true }) res: any) {
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const [rows] = await this.db.db.query<any[]>("SELECT * FROM users WHERE username = ?", [username]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401);
      return { ok: false, error: "用户名或密码错误" };
    }
    const token = await this.auth.createSession(user.id);
    res.setHeader("Set-Cookie", this.auth.cookie(token, 30 * 86400));
    return { ok: true, user: { id: user.id, username: user.username, role: user.role } };
  }

  @Post("password")
  async changePassword(@Req() req: any, @Body() body: any, @Res({ passthrough: true }) res: any) {
    const user = await this.auth.currentUser(req);
    if (!user) {
      res.status(401);
      return { ok: false, error: "请先登录" };
    }
    const current = String(body?.current || "");
    const next = String(body?.next || "");
    if (next.length < 8) {
      res.status(400);
      return { ok: false, error: "新密码至少 8 位" };
    }
    const [rows] = await this.db.db.query<any[]>("SELECT password_hash FROM users WHERE id = ?", [user.id]);
    if (!rows.length || !verifyPassword(current, rows[0].password_hash)) {
      res.status(400);
      return { ok: false, error: "当前密码不正确" };
    }
    await this.db.db.query("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(next), user.id]);
    const token = parseCookies(req)[COOKIE] || "";
    await this.db.db.query("DELETE FROM sessions WHERE user_id = ? AND token <> ?", [user.id, token]);
    return { ok: true };
  }

  @Post("logout")
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const token = parseCookies(req)[COOKIE];
    if (token) await this.db.db.query("DELETE FROM sessions WHERE token = ?", [token]);
    res.setHeader("Set-Cookie", this.auth.cookie("", 0));
    return { ok: true };
  }

  @Get("me")
  async me(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const user = await this.auth.currentUser(req);
    if (!user) {
      res.status(401);
      return { ok: false, error: "未登录" };
    }
    return { ok: true, user };
  }
}
