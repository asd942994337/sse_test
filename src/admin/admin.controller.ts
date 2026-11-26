import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";
import { DbService } from "../db/db.service";
import { hashPassword } from "../auth/auth.service";
import { TelemetryService } from "../telemetry/telemetry.service";

/**
 * 管理后台接口。
 *
 * 整个控制器挂 AdminGuard —— 注意是挂在**类**上，
 * 这样以后新增的方法默认就是受保护的，不会漏。
 */
@Controller("api/admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly db: DbService,
    private readonly telemetry: TelemetryService
  ) {}

  // ---------------------------------------------------------------------------
  //  概览
  // ---------------------------------------------------------------------------
  @Get("overview")
  overview(@Query("days") days: string) {
    return this.admin.overview(Number(days) || 7);
  }

  @Get("events")
  events(
    @Query("kind") kind: string,
    @Query("days") days: string,
    @Query("limit") limit: string,
    @Query("offset") offset: string
  ) {
    return this.admin.events({
      kind: String(kind || "").trim() || undefined,
      days: Number(days) || 7,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  }

  @Get("meta")
  meta() {
    return {
      ok: true,
      kinds: this.admin.kinds(),
      // 采集队列的实时状态：能看出"是不是没在写"
      telemetry: this.telemetry.stats(),
      dbReady: this.db.ready,
    };
  }

  // ---------------------------------------------------------------------------
  //  用户管理
  // ---------------------------------------------------------------------------
  @Get("users")
  async users() {
    const [rows] = await this.db.db.query<any[]>(
      `SELECT u.id, u.username, u.role, u.created_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS sessions
         FROM users u ORDER BY u.id`
    );
    return { ok: true, items: rows };
  }

  @Post("users")
  async createUser(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const role = body?.role === "admin" ? "admin" : "user";

    if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) {
      res.status(400);
      return { ok: false, error: "用户名只能包含字母数字下划线，3~32 位" };
    }
    if (password.length < 8) {
      res.status(400);
      return { ok: false, error: "密码至少 8 位" };
    }

    const passwordHash = await hashPassword(password);
    try {
      await this.db.db.query("INSERT INTO users (username, password_hash, role) VALUES (?,?,?)", [
        username,
        passwordHash,
        role,
      ]);
    } catch (err: any) {
      res.status(400);
      return { ok: false, error: err.code === "ER_DUP_ENTRY" ? "用户名已存在" : err.message };
    }
    return { ok: true };
  }

  @Patch("users/:id")
  async updateUser(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const uid = Number(id);
    const me = (req as any).user;
    if (!Number.isInteger(uid)) {
      res.status(400);
      return { ok: false, error: "id 不合法" };
    }

    // 别把自己降级，否则会把自己锁在门外
    if (uid === me?.id && body?.role && body.role !== "admin") {
      res.status(400);
      return { ok: false, error: "不能取消自己的管理员权限" };
    }

    if (body?.role === "admin" || body?.role === "user") {
      await this.db.db.query("UPDATE users SET role = ? WHERE id = ?", [body.role, uid]);
    }
    if (typeof body?.password === "string" && body.password.length >= 8) {
      await this.db.db.query("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(body.password), uid]);
      // 改密码后踢掉该用户所有会话
      await this.db.db.query("DELETE FROM sessions WHERE user_id = ?", [uid]);
    }
    return { ok: true };
  }

  @Delete("users/:id")
  async deleteUser(@Param("id") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const uid = Number(id);
    const me = (req as any).user;
    if (uid === me?.id) {
      res.status(400);
      return { ok: false, error: "不能删除自己" };
    }
    await this.db.db.query("DELETE FROM users WHERE id = ?", [uid]);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  //  维护
  // ---------------------------------------------------------------------------
  /** 手动清理：按保留天数删老事件 */
  @Post("cleanup")
  async cleanup(@Body() body: any) {
    const days = Math.max(3, Math.min(365, Number(body?.days) || 90));
    const [res] = await this.db.db.query<any>(
      "DELETE FROM events WHERE ts < DATE_SUB(NOW(), INTERVAL ? DAY)",
      [days]
    );
    return { ok: true, deleted: Number(res?.affectedRows || 0), days };
  }
}
