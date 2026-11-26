/**
 * 登录失败节流：只数失败，不数成功。
 *
 * 为什么需要：登录接口会跑 scrypt（一次 ~50ms CPU），而且没有任何限速，
 * 压测/撞库可以一直打。这里按「客户端 IP + 用户名」记失败次数，
 * 5 分钟内失败 10 次就返回 429，成功一次立刻清零。
 *
 * 状态放内存：现在只有一个 api 容器，够用；
 * 以后上多实例要换成 Redis 或用 Nginx 的 limit_req。
 */
const WINDOW_MS = 5 * 60_000;
const MAX_FAILS = 10;
const MAX_ENTRIES = 5000;

type Entry = { fails: number; resetAt: number };

const table = new Map<string, Entry>();

/** 取客户端 IP：Nginx 反代会写 X-Real-IP / X-Forwarded-For，容器网络里 api 看不到真实来源 */
function clientIp(req: any): string {
  return (
    String(req?.headers?.["x-real-ip"] || "").trim() ||
    String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() ||
    req?.socket?.remoteAddress ||
    "unknown"
  );
}

export function loginKey(req: any, username: string): string {
  return `${clientIp(req)}|${String(username || "").trim().toLowerCase()}`;
}

export const LOGIN_WINDOW_MIN = Math.ceil(WINDOW_MS / 60_000);

export function isLoginBlocked(key: string): boolean {
  const e = table.get(key);
  if (!e) return false;
  if (Date.now() > e.resetAt) {
    table.delete(key);
    return false;
  }
  return e.fails >= MAX_FAILS;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const e = table.get(key);
  if (!e || now > e.resetAt) {
    if (table.size >= MAX_ENTRIES) prune(now);
    table.set(key, { fails: 1, resetAt: now + WINDOW_MS });
    return;
  }
  e.fails += 1;
}

export function clearLoginFailures(key: string): void {
  table.delete(key);
}

function prune(now: number): void {
  for (const [k, v] of table) {
    if (now > v.resetAt) table.delete(k);
  }
}
