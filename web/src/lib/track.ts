/**
 * 前端埋点。
 *
 * 三条原则：
 *   1. **绝不影响主流程**：全部 try/catch 吞掉，埋点失败不能影响用户操作
 *   2. **用 sendBeacon**：页面关闭/跳转时也能把事件送出去（fetch 会被中断）
 *   3. **不采 PII**：没有 IP（服务端做 HMAC）、没有 UA 全文、没有精确位置
 *
 * 访客标识用 localStorage 里的随机 UUID，清缓存就换新人 ——
 * 这是"匿名统计"该有的粒度，不需要也做不到识别到人。
 */

const VISITOR_KEY = "hx_vid";
const ENDPOINT = "/api/t/event";

/** 拿/建匿名访客 ID */
export function visitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, "").slice(0, 32);
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return "";
  }
}

type Props = Record<string, string | number | boolean | null | undefined>;

/**
 * 发一个事件。
 * @param kind page_view / search / guide_open / guide_done / chat_ask / error …
 */
export function track(kind: string, props: Props = {}, target = "") {
  try {
    const body = JSON.stringify({
      kind,
      visitor: visitorId(),
      path: location.pathname,
      target,
      props,
    });

    // sendBeacon 是异步且不阻塞页面，页面要关了也能发出去
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
    // 老浏览器兜底
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 埋点永远不能抛错 */
  }
}

/** 页面浏览：带上进入时间，离开时补一条停留时长 */
export function trackPageView(path: string) {
  track("page_view", { t: Date.now() }, path);
}

/**
 * 搜索埋点 —— 这是最有价值的一条。
 * `n === 0` 说明"用户想找的东西你没有"，比任何 PV 数字都值钱。
 */
export function trackSearch(word: string, n: number) {
  track("search", { n }, word.slice(0, 200));
}
