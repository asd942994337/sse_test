import { useCallback, useEffect, useState } from "react";
import { StatsGrid } from "../components/StatsGrid";
import { NotesPanel } from "../components/NotesPanel";
import { EchoPanel } from "../components/EchoPanel";

export function SystemPage() {
  const [tick, setTick] = useState(0);
  const [ok, setOk] = useState<boolean | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">SYSTEM PANEL</p>
        <h1 className="hero-title">系统面板</h1>
        <p className="hero-sub">
          这台服务器的实时状态：容器主机名、数据库连接、请求计数。也是当初练部署时留下的仪表盘。
        </p>
        <p className={`dot-line ${ok === null ? "" : ok ? "ok" : "bad"}`}>
          {ok === null ? "检测中…" : ok ? "接口正常" : "接口异常"}
          <button className="btn" onClick={refresh}>
            刷新
          </button>
        </p>
      </header>

      <StatsGrid tick={tick} onStatus={setOk} />
      <NotesPanel tick={tick} />
      <EchoPanel />
    </main>
  );
}
