import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";

/**
 * 管理员守卫。
 *
 * 为什么需要它：项目里 `users.role` 这个字段一直存在，
 * 但**从来没有地方校验过** —— 也就是说现在的 `role` 只是个展示字段。
 * 在它被真正用上之前，任何「管理后台」都只是"看不见"，不是"进不去"。
 *
 * 这个守卫必须在**接口层**生效，不能只靠前端隐藏菜单：
 * 前端隐藏只是体验，接口拒绝才是安全。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = await this.auth.currentUser(req);
    if (!user) throw new UnauthorizedException("请先登录");
    if (user.role !== "admin") throw new ForbiddenException("需要管理员权限");

    req.user = user; // 后面的 handler 直接用
    return true;
  }
}
