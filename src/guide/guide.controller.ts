import { Body, Controller, Get, Param, Patch, Query, Req, Res, UseGuards } from "@nestjs/common";
import { GuideService } from "./guide.service";
import { AuthGuard } from "../auth/auth.guard";

@Controller("api")
@UseGuards(AuthGuard)
export class GuideController {
  constructor(private readonly guides: GuideService) {}

  @Get("games")
  list(@Req() req: any) {
    return this.guides.listGames(req.user.id);
  }

  @Get("games/:slug")
  async detail(@Param("slug") slug: string, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const data = await this.guides.detail(slug, req.user.id);
    if (!data) {
      res.status(404);
      return { ok: false, error: "游戏不存在" };
    }
    return data;
  }

  @Patch("guides/:id")
  toggle(@Param("id") id: string, @Body() body: any, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const guideId = Number(id);
    if (!Number.isInteger(guideId)) {
      res.status(400);
      return { ok: false, error: "id 不合法" };
    }
    return this.guides.toggle(guideId, req.user.id, Boolean(body?.done));
  }

  @Get("characters")
  characters() {
    return this.guides.characters();
  }

  @Get("search")
  search(@Query("q") q: string) {
    return this.guides.search(String(q || "").trim());
  }
}
