import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { getGames, type GameSummary } from "../api";
import { track } from "../lib/track";

export function Home() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getGames()
      .then((res) => {
        if (alive) setGames(res.items);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const totalDone = games.reduce((s, g) => s + Number(g.done), 0);
  const totalAll = games.reduce((s, g) => s + Number(g.total), 0);

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">PERSONAL ARCHIVE · 2026</p>
        <h1 className="hero-title">攻略档案</h1>
        <p className="hero-sub">
          在玩的游戏，拆成一条条能勾掉的条目。边玩边记，漏了的东西下次回来补。
        </p>
        <div className="hero-stats">
          <span>
            <b>{games.length}</b> 部作品
          </span>
          <span>
            <b>{totalAll}</b> 条攻略
          </span>
          <span>
            <b>
              {totalDone}/{totalAll}
            </b>{" "}
            已完成
          </span>
        </div>
      </header>

      {error && <p className="error-box">加载失败：{error}</p>}

      <section className="game-grid">
        {games.map((g) => {
          const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
          return (
            <Link
              to={`/g/${g.slug}`}
              className="game-card"
              key={g.slug}
              style={{ "--accent": g.accent } as CSSProperties}
              onClick={() => track("guide_open", { from: "home" }, g.slug)}
            >
              <div className="game-card-glow" />
              <div className="game-card-body">
                <div className="game-meta">
                  <span>{g.platform}</span>
                  <span>{g.year}</span>
                </div>
                <h2 className="game-title">{g.title}</h2>
                <p className="game-subtitle">{g.subtitle}</p>
                <p className="game-summary">{g.summary}</p>
              </div>
              <div className="game-progress">
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span>
                  {g.done}/{g.total}
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
