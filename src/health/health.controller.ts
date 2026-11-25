import { Controller, Get, Res } from "@nestjs/common";
import { DbService } from "../db/db.service";
import * as os from "os";

@Controller("api")
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get("hello")
  hello() {
    return {
      message: "Hello from hello-stack (nest)",
      hostname: os.hostname(),
      pid: process.pid,
      env: process.env.NODE_ENV || "development",
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      db: { ready: this.db.ready, error: this.db.lastError },
      now: new Date().toISOString(),
    };
  }

  @Get("health")
  health() {
    return { status: this.db.ready ? "ok" : "degraded", uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get("ready")
  ready(@Res({ passthrough: true }) res: any) {
    if (!this.db.ready) {
      res.status(503);
      return { status: "not-ready", db: "down", error: this.db.lastError };
    }
    return { status: "ready", db: "up" };
  }
}
