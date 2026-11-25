import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getGame, setGuideDone, type GameDetail, type GuideItem, type GuideSection } from "../api";

type TabKey = "all" | "flow" | "quest" | "collect" | "system";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "flow", label: "全流程" },
  { key: "quest", label: "支线" },
  { key: "collect", label: "收集" },
  { key: "system", label: "系统" },
];

const BASE_TAGS = new Set(["收集", "支线", "主线", "流程"]);

export function GuidePage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const focus = Number(params.get("focus") ?? 0);

  const [data, setData] = useState<GameDetail | null>(null);
  const [sections, setSections] = useState<GuideSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [sub, setSub] = useState<string>("");
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setTab("all");
    setSub("");
    getGame(slug)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setSections(res.sections);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const { total, done } = useMemo(() => {
    let t = 0;
    let d = 0;
    for (const s of sections) {
      for (const it of s.items) {
        t += 1;
        if (it.done) d += 1;
      }
    }
    return { total: t, done: d };
  }, [sections]);

  // 分区进度按完整数据算，不受「只看未完成」筛选影响
  const stats = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const s of sections) {
      let t = 0;
      let d = 0;
      for (const it of s.items) {
        t += 1;
        if (it.done) d += 1;
      }
      m.set(s.name, { total: t, done: d });
    }
    return m;
  }, [sections]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 640);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!focus || !data) return;
    const el = document.getElementById(`entry-${focus}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("is-focus");
    const timer = setTimeout(() => el.classList.remove("is-focus"), 2200);
    return () => clearTimeout(timer);
  }, [focus, data]);

  const subStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sections) {
      for (const it of s.items) {
        if (tab !== "all" && it.kind !== tab) continue;
        for (const raw of (it.tags || "").split(",")) {
          const t = raw.trim();
          if (!t || BASE_TAGS.has(t)) continue;
          m.set(t, (m.get(t) || 0) + 1);
        }
      }
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, n]) => n >= 2)
      .slice(0, 10);
  }, [sections, tab]);

  const matchSub = (it: GuideItem) => {
    if (!sub) return true;
    return (it.tags || "")
      .split(",")
      .map((x) => x.trim())
      .includes(sub);
  };

  const visible = sections
    .map((s) => ({
      ...s,
      items: s.items.filter(
        (it) => (tab === "all" || it.kind === tab) && matchSub(it) && (!onlyTodo || !it.done)
      ),
    }))
    .filter((s) => s.items.length > 0);

  const countOf = (kind: TabKey) =>
    kind === "all"
      ? sections.reduce((n, s) => n + s.items.length, 0)
      : sections.reduce((n, s) => n + s.items.filter((it) => it.kind === kind).length, 0);

  async function toggle(id: number, next: boolean) {
    setBusyId(id);
    setSections((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.map((it) => (it.id === id ? { ...it, done: next ? 1 : 0 } : it)),
      }))
    );
    try {
      await setGuideDone(id, next);
    } catch {
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          items: s.items.map((it) => (it.id === id ? { ...it, done: next ? 0 : 1 } : it)),
        }))
      );
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <main className="wrap">
        <p className="error-box">加载失败：{error}</p>
        <Link className="back-link" to="/">
          ← 回到档案
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="wrap">
        <p className="loading">加载中…</p>
      </main>
    );
  }

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <main className="wrap" style={{ "--accent": data.game.accent } as CSSProperties}>
      <Link className="back-link" to="/">
        ← 回到档案
      </Link>

      {slug === "fire-emblem-fortunes-weave" && (
        <Link className="back-link codex-link" to="/characters">
          角色图鉴 →
        </Link>
      )}

      <header className="game-hero">
        <div className="game-hero-text">
          <div className="game-meta">
            <span>{data.game.platform}</span>
            <span>{data.game.year}</span>
          </div>
          <h1>{data.game.title}</h1>
          <p className="game-subtitle">{data.game.subtitle}</p>
          <p className="game-summary">{data.game.summary}</p>
        </div>

        <div className="ring" style={{ "--pct": `${pct}%` } as CSSProperties}>
          <div className="ring-inner">
            <b>{pct}%</b>
            <span>
              {done}/{total}
            </span>
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "on" : ""}`}
            onClick={() => {
              setTab(t.key);
              setSub("");
            }}
          >
            {t.label}
            <i>{countOf(t.key)}</i>
          </button>
        ))}
      </nav>

      <div className="guide-tools">
        <button
          className={`subtab ${onlyTodo ? "on" : ""}`}
          onClick={() => setOnlyTodo((v) => !v)}
          title="隐藏已完成的条目"
        >
          {onlyTodo ? "显示全部" : "只看未完成"}
        </button>
        <span className="guide-count">
          共 {total} 条 · 已完成 {done}
        </span>
      </div>

      {subStats.length > 0 && (
        <nav className="subtabs">
          <button className={`subtab ${sub === "" ? "on" : ""}`} onClick={() => setSub("")}>
            全部类型
            <i>{tab === "all" ? countOf("all") : countOf(tab)}</i>
          </button>
          {subStats.map(([name, n]) => (
            <button
              key={name}
              className={`subtab ${sub === name ? "on" : ""}`}
              onClick={() => setSub(name)}
            >
              {name}
              <i>{n}</i>
            </button>
          ))}
        </nav>
      )}

      <div className="guide-layout">
        <aside className="toc">
          <p className="toc-title">目录</p>
          {visible.map((s, i) => {
            const st = stats.get(s.name) ?? { total: s.items.length, done: 0 };
            const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
            return (
              <a key={s.name} href={`#sec-${tab}-${i}`} className="toc-item">
                <span className="toc-name">{s.name}</span>
                <i>
                  {st.done}/{st.total}
                </i>
                <span className="toc-bar">
                  <b style={{ width: `${pct}%` }} />
                </span>
              </a>
            );
          })}
        </aside>

        <div className="guide-main">
          {visible.length === 0 && (
            <p className="muted">
              {onlyTodo && total > 0 ? "这个分类下的条目都勾完了 🎉" : "这个分类下还没有条目。"}
            </p>
          )}

          {visible.map((s, si) => (
            <section key={s.name} id={`sec-${tab}-${si}`} className="sec">
              <h2 className="sec-title">
                {s.name}
                <span className="sec-count">
                  {stats.get(s.name)?.done ?? 0}/{stats.get(s.name)?.total ?? s.items.length}
                </span>
                <span className="sec-line" />
              </h2>

              {s.items.map((it, idx) => (
                <article
                  key={it.id}
                  id={`entry-${it.id}`}
                  className={`entry ${it.done ? "is-done" : ""}`}
                >
                  <div className="entry-head">
                    <span className="entry-no">{String(idx + 1).padStart(2, "0")}</span>
                    <h3>{it.title}</h3>
                    <button
                      className={`done-btn ${it.done ? "on" : ""}`}
                      disabled={busyId === it.id}
                      onClick={() => toggle(it.id, !it.done)}
                    >
                      {it.done ? "已完成" : "标记完成"}
                    </button>
                  </div>

                  {it.tags && (
                    <div className="tags">
                      {it.tags
                        .split(",")
                        .filter((t) => t.trim() && !BASE_TAGS.has(t.trim()))
                        .map((t) => (
                          <span key={t}>{t.trim()}</span>
                        ))}
                    </div>
                  )}

                  <div className="entry-body">{it.body}</div>
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>

      {showTop && (
        <button
          className="to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="回到顶部"
        >
          ↑ 顶部
        </button>
      )}
    </main>
  );
}
