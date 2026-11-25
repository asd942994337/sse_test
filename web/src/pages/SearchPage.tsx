import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { searchGuides, type SearchItem } from "../api";
import { trackSearch } from "../lib/track";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("q") ?? "";
  const [text, setText] = useState(initial);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = params.get("q") ?? "";
    setText(q);
    if (!q.trim()) {
      setItems([]);
      setTotal(0);
      return;
    }
    let alive = true;
    setLoading(true);
    searchGuides(q)
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setTotal(res.total);
        setError(null);
        // 埋点：关键词 + 命中数。0 命中的词是最有价值的信号 ——
        // 它直接告诉你库里缺了哪块内容
        trackSearch(q, res.total);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [params]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setParams(text.trim() ? { q: text.trim() } : {});
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">SEARCH</p>
        <h1 className="hero-title">查询</h1>
        <p className="hero-sub">全部游戏的条目一起搜：标题、正文、标签都算。</p>
      </header>

      <form className="search-row" onSubmit={onSubmit}>
        <input
          className="input"
          autoFocus
          placeholder="试试：白赤练 / 心之碎片 / 烈焰技 / 转职"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          搜索
        </button>
      </form>

      {loading && <p className="loading">搜索中…</p>}
      {error && <p className="error-box">搜索失败：{error}</p>}

      {!loading && !error && params.get("q") && (
        <p className="search-count">
          找到 <b>{total}</b> 条
        </p>
      )}

      <div className="search-list">
        {items.map((it) => (
          <Link
            key={it.id}
            to={`/g/${it.gameSlug}?focus=${it.id}`}
            className="search-item"
            style={{ borderLeftColor: it.accent }}
          >
            <div className="search-item-head">
              <span className="search-game" style={{ color: it.accent }}>
                {it.gameTitle}
              </span>
              <span className="search-sec">{it.section}</span>
            </div>
            <h3>{it.title}</h3>
            <p>{it.snippet}</p>
          </Link>
        ))}
      </div>

      {!loading && params.get("q") && items.length === 0 && (
        <p className="muted">没搜到。换个关键词试试，比如"支线""心之碎片""白赤练"。</p>
      )}
    </main>
  );
}
