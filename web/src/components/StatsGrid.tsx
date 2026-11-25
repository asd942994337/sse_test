import { useEffect, useState } from "react";
import { getHello, type HelloInfo } from "../api";

/** 想加卡片？往 FIELDS 里加一行就行，类型会强制你写对返回的字符串 */
const FIELDS: Array<[string, (d: HelloInfo) => string]> = [
  ["服务", (d) => d.service],
  ["主机名", (d) => d.hostname],
  ["进程 PID", (d) => String(d.pid)],
  ["Node 版本", (d) => d.node],
  ["运行时长", (d) => fmtDuration(d.uptimeSeconds)],
  ["累计请求", (d) => String(d.requests)],
  ["数据库", (d) => (d.db.ready ? `${d.db.host} / ${d.db.database}` : "未连接")],
  ["客户端 IP", (d) => d.client.ip],
  ["X-Forwarded-For", (d) => d.client.forwardedFor ?? "（直连，没有代理）"],
  ["服务器时间", (d) => d.now.replace("T", " ").slice(0, 19)],
  ["运行环境", (d) => d.env],
];

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分 ${sec % 60} 秒`;
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`;
}

type Props = {
  tick: number;
  onStatus: (ok: boolean) => void;
};

export function StatsGrid({ tick, onStatus }: Props) {
  const [data, setData] = useState<HelloInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true; // 组件卸载后别再 setState（React 会警告内存泄漏）
    getHello()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
        onStatus(true);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        onStatus(false);
      });
    return () => {
      alive = false;
    };
  }, [tick, onStatus]);

  if (error) {
    return (
      <section className="grid">
        <div className="card">
          <div className="k">请求失败</div>
          <div className="v">{error}</div>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="grid">
        <div className="card">
          <div className="k">加载中</div>
          <div className="v">…</div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid">
      {FIELDS.map(([label, pick]) => (
        <div className="card" key={label}>
          <div className="k">{label}</div>
          <div className="v">{pick(data)}</div>
        </div>
      ))}
    </section>
  );
}
