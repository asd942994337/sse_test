/**
 * 运行时的模型配置（只存内存，不落盘、不下发原文）。
 *
 * 优先级：界面上的配置 > 环境变量 > 默认值。
 *
 * 为什么 key 不存浏览器：
 *   存 localStorage 的话，任何 XSS 或浏览器扩展都能读走，而且会一直留着。
 *   所以 key 通过 POST 上传到本机服务端，只存在进程内存里，
 *   浏览器只能拿到掩码（sk-abc…wxyz）。
 *
 * 代价：服务重启就没了 —— 想长期保存就写进 .env。
 */

export interface RagConfigPatch {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 搜索源：tavily / brave / serper，留空则用抓取兜底 */
  searchProvider?: string;
  searchKey?: string;
}

interface RuntimeConfig extends RagConfigPatch {
  updatedAt?: number;
}

let runtime: RuntimeConfig | null = null;

/**
 * 持久化到本地文件（.rag-config.json，已加进 .gitignore）。
 *
 * 为什么要有：配置只在内存里的话，每次重启服务都得重填 key，
 * 调试期间重启十次就得填十次，非常烦。
 *
 * 注意：这个文件里会有明文 key，和 .env 是一个性质。
 * 生产环境请改用环境变量，别用这个文件。
 */
const STORE = require("node:path").join(process.cwd(), ".rag-config.json");

function loadFromDisk(): RuntimeConfig | null {
  try {
    const raw = require("node:fs").readFileSync(STORE, "utf8");
    const data = JSON.parse(raw);
    return typeof data === "object" && data ? data : null;
  } catch {
    return null;
  }
}

function saveToDisk(cfg: RuntimeConfig | null) {
  try {
    const fs = require("node:fs");
    if (cfg === null) {
      if (fs.existsSync(STORE)) fs.unlinkSync(STORE);
      return;
    }
    // 0o600：只有当前用户能读，别让同机器其他账户看到 key
    fs.writeFileSync(STORE, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* 写不进去就算了，不影响内存里的配置 */
  }
}

// 启动时先读一次本地文件（数据库里的配置会在 SettingsService 启动后覆盖它）
runtime = loadFromDisk();

/**
 * 用外部来源（数据库）填进来，不写文件。
 * 数据库是跨容器的持久层，优先级高于文件。
 */
export function loadFromValues(values: RagConfigPatch | null): void {
  if (!values) return;
  runtime = { ...(runtime || {}), ...values, updatedAt: Date.now() };
}

/** 合并式写入：字段为 undefined 表示「不动这一项」 */
export function setRuntime(patch: RagConfigPatch): RuntimeConfig {
  const prev = runtime || {};
  runtime = {
    apiKey: patch.apiKey === undefined ? prev.apiKey : patch.apiKey,
    baseUrl: patch.baseUrl === undefined ? prev.baseUrl : patch.baseUrl,
    model: patch.model === undefined ? prev.model : patch.model,
    searchProvider: patch.searchProvider === undefined ? prev.searchProvider : patch.searchProvider,
    searchKey: patch.searchKey === undefined ? prev.searchKey : patch.searchKey,
    updatedAt: Date.now(),
  };
  saveToDisk(runtime);
  return runtime;
}

export function getRuntime(): RuntimeConfig | null {
  return runtime;
}

export function clearRuntime(): void {
  runtime = null;
  saveToDisk(null);
}

/** sk-abcdefghijklmn → sk-abc…klmn */
export function maskKey(key?: string): string {
  const s = String(key || "");
  if (!s) return "";
  if (s.length <= 10) return "*".repeat(Math.min(s.length, 8));
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
