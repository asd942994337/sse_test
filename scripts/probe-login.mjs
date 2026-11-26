// 登录并发探针：N 个并发 POST /api/auth/login，同时每 100ms 探一次 /api/health，
// 用来区分「登录慢」和「整站被拖死」——后者是同步 scrypt 的典型症状。
//
// 用法（需要先在库里有一个测试账号，测完删掉）：
//   PROBE_USER=_probe PROBE_PASS=你的测试密码 node scripts/probe-login.mjs 30
//   node scripts/probe-login.mjs 30          # 默认 _probe + 错误密码，只量 CPU 成本
const N = Number(process.argv[2] || 30);

const base = "http://120.25.123.48:8080";
const body = JSON.stringify({ username: process.env.PROBE_USER || "_probe", password: process.env.PROBE_PASS || "wrong-pass" });

async function loginOnce(i) {
  const t = process.hrtime.bigint();
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await res.text();
    return { i, status: res.status, ms: Number(process.hrtime.bigint() - t) / 1e6 };
  } catch (e) {
    return { i, status: "ERR", ms: Number(process.hrtime.bigint() - t) / 1e6, err: String(e.message || e) };
  }
}

const healthSamples = [];
let stop = false;
const health = (async () => {
  while (!stop) {
    const t = process.hrtime.bigint();
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
      await r.text();
      healthSamples.push({ ms: Number(process.hrtime.bigint() - t) / 1e6, status: r.status });
    } catch (e) {
      healthSamples.push({ ms: Number(process.hrtime.bigint() - t) / 1e6, status: "ERR" });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();

const started = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => loginOnce(i)));
stop = true;
await health;
const wall = Date.now() - started;

const lat = results.map((r) => r.ms).sort((a, b) => a - b);
const p = (q) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))].toFixed(0);
const statuses = {};
for (const r of results) statuses[r.status] = (statuses[r.status] || 0) + 1;

const h = healthSamples.map((s) => s.ms).sort((a, b) => a - b);
const hp = (q) => (h.length ? h[Math.min(h.length - 1, Math.floor(q * h.length))].toFixed(0) : "-");
const hErr = healthSamples.filter((s) => s.status !== 200).length;

console.log(`并发=${N} 总耗时=${(wall / 1000).toFixed(2)}s`);
console.log(`登录延迟 ms: p50=${p(0.5)} p90=${p(0.9)} max=${lat[lat.length - 1].toFixed(0)}`);
console.log(`状态码: ${JSON.stringify(statuses)}`);
console.log(`健康探测: 次数=${healthSamples.length} p50=${hp(0.5)} p95=${hp(0.95)} max=${hp(1)} 非200=${hErr}`);
