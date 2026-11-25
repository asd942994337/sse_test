/** 后端返回的数据结构，和 server.js 一一对应 */

export type DbInfo = {
  ready: boolean;
  host: string;
  database: string;
  error: string | null;
};

export type HelloInfo = {
  message: string;
  service: string;
  hostname: string;
  pid: number;
  env: string;
  node: string;
  uptimeSeconds: number;
  startedAt: string;
  now: string;
  requests: number;
  db: DbInfo;
  client: { ip: string; realIp: string | null; forwardedFor: string | null };
};

export type Note = {
  id: number;
  content: string;
  done: number;
  created_at: string;
  updated_at: string;
};

/* ---------------- 攻略站 ---------------- */

export type GameSummary = {
  slug: string;
  title: string;
  subtitle: string;
  platform: string;
  year: number;
  accent: string;
  summary: string;
  total: number;
  done: number;
};

export type GuideItem = {
  id: number;
  title: string;
  body: string;
  tags: string;
  kind: string;
  done: number;
};

export type GuideSection = {
  name: string;
  kind: string;
  items: GuideItem[];
};

export type GameDetail = {
  ok: boolean;
  game: Omit<GameSummary, "total" | "done">;
  sections: GuideSection[];
  total: number;
  done: number;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const getHello = () => request<HelloInfo>("/api/hello");

export const getNotes = () => request<{ ok: boolean; total: number; items: Note[] }>("/api/notes");

export const addNote = (content: string) =>
  request<{ ok: boolean; item: Note }>("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

export const updateNote = (id: number, patch: { content?: string; done?: boolean }) =>
  request<{ ok: boolean; item: Note }>(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const deleteNote = (id: number) =>
  request<{ ok: boolean; deleted: number }>(`/api/notes/${id}`, { method: "DELETE" });

export const postEcho = () =>
  request<Record<string, unknown>>("/api/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "react 前端", at: new Date().toISOString() }),
  });

export const getGames = () => request<{ ok: boolean; items: GameSummary[] }>("/api/games");

export const getGame = (slug: string) => request<GameDetail>(`/api/games/${slug}`);

export const setGuideDone = (id: number, done: boolean) =>
  request<{ ok: boolean; id: number; done: number }>(`/api/guides/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });

export type CharSkill = { n: string; d: string };
export type Gift = { n: string; p: string; c: string; v: string };
export type Support = { n: string; r: string; e: boolean };

export type CharacterDetail = {
  startClass: string;
  startLv: number;
  growth: number[];
  growthTotal: number | null;
  init: number[];
  initTotal: number | null;
  lv60: number[];
  lv60Total: number | null;
  rank: string[];
  initRank: string[];
  skills: CharSkill[];
  core: CharSkill[];
  bio: { intro: string; facts: Record<string, string> };
  gifts: { bestCount: number; likeCount: number; best: Gift[]; like: Gift[] };
  supports: { meta: string; items: Support[] };
  build: { lead: string; path: string[] };
};

export type Character = {
  slug: string;
  name: string;
  en: string;
  tier: string;
  cls: string;
  weapons: string[];
  expert: string[];
  routes: string[];
  rel: Record<string, string>;
  later: string;
  img: string;
  detail: CharacterDetail;
};

export const getCharacters = () =>
  request<{ ok: boolean; total: number; items: Character[] }>("/api/characters");

export type SearchItem = {
  id: number;
  gameSlug: string;
  gameTitle: string;
  accent: string;
  section: string;
  kind: string;
  title: string;
  snippet: string;
};

export const searchGuides = (q: string) =>
  request<{ ok: boolean; q: string; total: number; items: SearchItem[] }>(
    `/api/search?q=${encodeURIComponent(q)}`
  );
/* ---------------- 登录 ---------------- */

export type AuthUser = { id: number; username: string; role: string };

export const authStatus = () =>
  request<{ ok: boolean; needSetup: boolean }>("/api/auth/status");

export const authMe = () => request<{ ok: boolean; user: AuthUser }>("/api/auth/me");

export const login = (username: string, password: string) =>
  request<{ ok: boolean; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });


export const logout = () =>
  request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
export const changePassword = (current: string, next: string) =>
  request<{ ok: boolean }>("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current, next }),
  });

/* ---------------- 管理后台 ---------------- */

export type AdminOverview = {
  ok: boolean;
  days: number;
  today: { pv: number; uv: number; searches: number; chats: number; errors: number };
  trend: { day: string; pv: number; uv: number }[];
  searches: { word: string; n: number; zero: number }[];
  guides: { target: string; n: number }[];
  chat: { n: number; avgMs: number; avgTtfb: number; webCalls: number };
  questions: { ts: string; question: string; mode: string; usedWeb: boolean }[];
  errors: { target: string; path: string; n: number; lastAt: string }[];
};

export type AdminEvent = {
  id: number;
  ts: string;
  kind: string;
  visitor: string;
  userId: number | null;
  path: string;
  target: string;
  props: Record<string, unknown> | null;
};

export type AdminUser = {
  id: number;
  username: string;
  role: string;
  created_at: string;
  sessions: number;
};

export const adminOverview = (days = 7) =>
  request<AdminOverview>(`/api/admin/overview?days=${days}`);

export const adminEvents = (p: { kind?: string; days?: number; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (p.kind) qs.set("kind", p.kind);
  if (p.days) qs.set("days", String(p.days));
  if (p.limit) qs.set("limit", String(p.limit));
  if (p.offset) qs.set("offset", String(p.offset));
  return request<{ ok: boolean; total: number; items: AdminEvent[] }>(`/api/admin/events?${qs}`);
};

export const adminMeta = () =>
  request<{
    ok: boolean;
    kinds: string[];
    telemetry: { queued: number; written: number; dropped: number };
    dbReady: boolean;
  }>("/api/admin/meta");

export const adminUsers = () => request<{ ok: boolean; items: AdminUser[] }>("/api/admin/users");

export const adminCreateUser = (username: string, password: string, role: string) =>
  request<{ ok: boolean }>("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
  });

export const adminUpdateUser = (id: number, patch: { role?: string; password?: string }) =>
  request<{ ok: boolean }>(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const adminDeleteUser = (id: number) =>
  request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" });

export const adminCleanup = (days: number) =>
  request<{ ok: boolean; deleted: number }>("/api/admin/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
