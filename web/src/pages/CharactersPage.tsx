import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getCharacters, type Character } from "../api";

const TIERS = ["SS", "S", "A", "B", "C", "D"];

type RouteFilter = "all" | "凯伊" | "迪托利希" | "赛奥朵拉" | "蕾达" | "later";

const ROUTES: Array<{ key: Exclude<RouteFilter, "all" | "later">; short: string }> = [
  { key: "凯伊", short: "凯" },
  { key: "迪托利希", short: "迪" },
  { key: "赛奥朵拉", short: "赛" },
  { key: "蕾达", short: "蕾" },
];

const STATS = [
  { label: "HP", color: "#e07a7a" },
  { label: "力量", color: "#e0a35b" },
  { label: "魔力", color: "#a98be0" },
  { label: "速度", color: "#67c98b" },
  { label: "技巧", color: "#5fc8d8" },
  { label: "防守", color: "#6f9fe0" },
  { label: "魔防", color: "#5fbfa8" },
  { label: "幸运", color: "#d8c15f" },
  { label: "魅力", color: "#e08bb0" },
];

type SheetTab = "data" | "build" | "bond" | "bio";

const SHEET_TABS: Array<{ key: SheetTab; label: string }> = [
  { key: "data", label: "能力" },
  { key: "build", label: "培养" },
  { key: "bond", label: "好感" },
  { key: "bio", label: "背景" },
];

function RouteDots({ c }: { c: Character }) {
  const hasRel = Object.keys(c.rel).length > 0;
  return (
    <>
      {hasRel &&
        ROUTES.map((r) => {
          const rel = c.rel[r.key];
          const state = rel === "初始加入" ? "own" : rel === "可挖角" ? "can" : "no";
          return (
            <span key={r.key} className={`route-dot ${state}`} title={`${r.key}线：${rel ?? "招不到"}`}>
              {r.short}
            </span>
          );
        })}
      {c.later && <span className="route-later">{c.later}</span>}
    </>
  );
}

export function CharactersPage() {
  const [items, setItems] = useState<Character[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<string>("all");
  const [route, setRoute] = useState<RouteFilter>("all");
  const [tab, setTab] = useState<SheetTab>("data");
  const [params, setParams] = useSearchParams();

  const selected = params.get("c");
  const current = items.find((c) => c.slug === selected) ?? null;
  const tabParam = params.get("t") as SheetTab | null;

  useEffect(() => {
    let alive = true;
    getCharacters()
      .then((res) => alive && setItems(res.items))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setTab(SHEET_TABS.some((t) => t.key === tabParam) ? (tabParam as SheetTab) : "data");
  }, [selected, tabParam]);

  const switchTab = (k: SheetTab) => {
    if (selected) setParams({ c: selected, t: k });
    else setTab(k);
  };

  const open = (slug: string) => setParams({ c: slug });
  const close = () => setParams({});

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const list = useMemo(() => {
    const text = q.trim().toLowerCase();
    const rank = (t: string) => {
      const i = TIERS.indexOf(t);
      return i < 0 ? 99 : i;
    };
    return items
      .filter((c) => {
        if (text) {
          const hay = `${c.name} ${c.en} ${c.cls} ${c.weapons.join(" ")} ${c.expert.join(" ")} ${Object.values(c.rel).join(" ")}`.toLowerCase();
          if (!hay.includes(text)) return false;
        }
        if (tier !== "all" && c.tier !== tier) return false;
        if (route === "later") return Boolean(c.later);
        if (route !== "all") {
          const rel = c.rel[route];
          return rel === "初始加入" || rel === "可挖角";
        }
        return true;
      })
      .sort((a, b) => rank(a.tier) - rank(b.tier) || a.name.localeCompare(b.name, "zh"));
  }, [items, q, tier, route]);

  const d = current?.detail;
  const rankGroups = d
    ? ["S", "A", "B", "C"].map((r) => ({ r, items: d.supports.items.filter((s) => s.r === r) })).filter((g) => g.items.length > 0)
    : [];

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">CODEX · 角色图鉴</p>
        <h1 className="hero-title">角色图鉴</h1>
        <p className="hero-sub">
          63 名可用角色的立绘、梯度、成长率、培养路线与四条线的招募关系。点任意头像看详情，
          也可以按梯度 / 主角线筛选、按名字或职业搜索。
        </p>
        <p className="hero-sub">梯度来自社区整理（SS → D），当作「先练谁」的参考，不是绝对强弱。</p>
      </header>

      {error && <p className="error-box">加载失败：{error}</p>}

      <div className="char-toolbar">
        <input
          className="input char-search"
          placeholder="搜名字 / 英文名 / 职业 / 武器"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="char-filter">
          <span className="char-filter-label">梯度</span>
          <button className={`chip ${tier === "all" ? "on" : ""}`} onClick={() => setTier("all")}>
            全部
          </button>
          {TIERS.map((t) => (
            <button key={t} className={`chip ${tier === t ? "on" : ""}`} onClick={() => setTier(t)}>
              {t}
            </button>
          ))}
        </div>

        <div className="char-filter">
          <span className="char-filter-label">主角线</span>
          <button className={`chip ${route === "all" ? "on" : ""}`} onClick={() => setRoute("all")}>
            全部
          </button>
          {ROUTES.map((r) => (
            <button key={r.key} className={`chip ${route === r.key ? "on" : ""}`} onClick={() => setRoute(r.key)}>
              {r.key}
            </button>
          ))}
          <button className={`chip ${route === "later" ? "on" : ""}`} onClick={() => setRoute("later")}>
            第三部加入
          </button>
        </div>

        <span className="char-count">
          {list.length} / {items.length}
        </span>
      </div>

      <p className="char-legend">
        <span className="legend-item">
          <span className="route-dot own">凯</span> 实心 = 该线初始加入
        </span>
        <span className="legend-item">
          <span className="route-dot can">迪</span> 绿边 = 该线可挖角
        </span>
        <span className="legend-item">
          <span className="route-dot no">赛</span> 灰 = 该线招不到
        </span>
        <span className="legend-item legend-note">
          四个圆点依次是：凯伊 / 迪托利希 / 赛奥朵拉 / 蕾达线
        </span>
      </p>

      <div className="char-grid">
        {list.map((c) => (
          <button
            type="button"
            className="char-card"
            key={c.slug}
            onClick={() => open(c.slug)}
            aria-label={`查看 ${c.name} 的详情`}
          >
            <span className="char-pic">
              <img src={`/${c.img}`} alt={c.name} loading="lazy" width={256} height={256} />
              {c.tier && <span className={`tier-badge tier-${c.tier}`}>{c.tier}</span>}
            </span>
            <span className="char-body">
              <span className="char-name">
                {c.name}
                {c.en && <small>{c.en}</small>}
              </span>
              <span className="char-meta">
                {c.cls}
                {c.weapons.length > 0 && <span> · {c.weapons.join(" / ")}</span>}
              </span>
              <span className="char-routes">
                <RouteDots c={c} />
              </span>
            </span>
          </button>
        ))}
      </div>

      {!error && items.length > 0 && list.length === 0 && (
        <p className="muted">没有符合条件的角色，换个梯度或关键词试试。</p>
      )}

      {current && d && (
        <div className="char-modal" role="dialog" aria-modal="true" aria-label={`${current.name} 详情`} onClick={close}>
          <div className="char-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="sheet-close" onClick={close} aria-label="关闭">
              ×
            </button>

            <header className="sheet-head">
              <img className="sheet-pic" src={`/${current.img}`} alt={current.name} width={256} height={256} />
              <div className="sheet-id">
                <div className="sheet-topline">
                  {current.tier && <span className={`tier-badge tier-${current.tier}`}>{current.tier}</span>}
                  <span className="sheet-cls">
                    {d.startClass}
                    {d.startLv ? ` Lv${d.startLv}` : ""}
                  </span>
                  {current.later && <span className="route-later">{current.later}</span>}
                </div>
                <h2 className="sheet-name">
                  {current.name}
                  {current.en && <small>{current.en}</small>}
                </h2>
                <p className="sheet-weapons">
                  {current.cls}
                  {current.weapons.length > 0 && <span> · 擅长 {current.weapons.join(" / ")}</span>}
                  {current.expert.length > 0 && <span> · 可练 {current.expert.join(" / ")}</span>}
                </p>
                <div className="sheet-routes">
                  {ROUTES.map((r) => {
                    const rel = current.rel[r.key];
                    if (!rel) return null;
                    const state = rel === "初始加入" ? "own" : rel === "可挖角" ? "can" : "no";
                    return (
                      <span key={r.key} className={`route-chip ${state}`}>
                        <b>{r.key}线</b>
                        {rel}
                      </span>
                    );
                  })}
                  {current.later && <span className="route-chip later">{current.later}</span>}
                </div>
              </div>
            </header>

            <nav className="sheet-tabs" role="tablist">
              {SHEET_TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`sheet-tab ${tab === t.key ? "on" : ""}`}
                  onClick={() => switchTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === "data" && (
              <>
                <section className="sheet-sec">
                  <h3>
                    成长率 <b>{d.growthTotal ?? "-"}%</b>
                    <span className="sheet-note">右侧为全员排名（共 63 人）</span>
                  </h3>
                  <div className="stat-list">
                    {STATS.map((s, i) => (
                      <div className="stat-row" key={s.label}>
                        <span className="stat-name">{s.label}</span>
                        <span className="stat-bar">
                          <i style={{ width: `${Math.min(100, d.growth[i] ?? 0)}%`, background: s.color }} />
                        </span>
                        <b className="stat-val">{d.growth[i] ?? "-"}%</b>
                        <span className="stat-rank">{d.rank[i] ?? ""}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="sheet-sec">
                  <h3>初始与 Lv60 期望</h3>
                  <div className="stat-table">
                    <div className="stat-thead">
                      <span />
                      <span>初始</span>
                      <span>Lv60</span>
                    </div>
                    {STATS.map((s, i) => (
                      <div className="stat-trow" key={s.label}>
                        <span className="stat-tname" style={{ color: s.color }}>
                          {s.label}
                        </span>
                        <span>{d.init[i] ?? "-"}</span>
                        <span>{d.lv60[i] ?? "-"}</span>
                      </div>
                    ))}
                    <div className="stat-trow stat-tsum">
                      <span className="stat-tname">合计</span>
                      <span>{d.initTotal ?? "-"}</span>
                      <span>{d.lv60Total ?? "-"}</span>
                    </div>
                  </div>
                  <p className="sheet-foot-note">
                    Lv60 为「期望值」样本（含兵种与培养方向），不是唯一答案；初始值为 Lv
                    {d.startLv || 1} 时的基础值。
                  </p>
                </section>

                {d.skills.length > 0 && (
                  <section className="sheet-sec">
                    <h3>特技 / 战技</h3>
                    <ul className="skill-list">
                      {d.skills.map((s) => (
                        <li key={s.n}>
                          <b>{s.n}</b>
                          <span>{s.d}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {d.core.length > 0 && (
                  <section className="sheet-sec">
                    <h3>核心特技</h3>
                    <ul className="skill-list">
                      {d.core.map((s) => (
                        <li key={s.n}>
                          <b>{s.n}</b>
                          <span>{s.d}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="sheet-sec">
                  <h3>怎么拿到</h3>
                  <div className="sheet-recruit">
                    {Object.keys(current.rel).length > 0 &&
                      ROUTES.map((r) => {
                        const rel = current.rel[r.key] ?? "招不到";
                        const state = rel === "初始加入" ? "own" : rel === "可挖角" ? "can" : "no";
                        return (
                          <span key={r.key} className={`recruit-line ${state}`}>
                            <b>{r.key}线</b>
                            {rel}
                          </span>
                        );
                      })}
                    {current.later && <span className="recruit-line later">{current.later}</span>}
                    {!current.later && Object.keys(current.rel).length === 0 && (
                      <span className="recruit-line no">暂无招募数据</span>
                    )}
                  </div>
                  <p className="sheet-foot-note">
                    具体名声 / 支援 / 交涉条件见{" "}
                    <Link to="/g/fire-emblem-fortunes-weave">万缕千丝攻略 · 招募分区</Link>。
                  </p>
                </section>
              </>
            )}

            {tab === "build" && (
              <>
                <section className="sheet-sec">
                  <h3>主推路线</h3>
                  {d.build.path.length > 0 ? (
                    <div className="build-path">
                      {d.build.path.map((p, i) => (
                        <span key={`${p}-${i}`} className="build-step">
                          {p}
                          {i < d.build.path.length - 1 && <em>→</em>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">暂无推荐路线。</p>
                  )}
                  {d.build.lead && <p className="build-lead">{d.build.lead}</p>}
                  <p className="sheet-foot-note">
                    路线来自社区整理，5 / 20 / 35 / 45 级是推荐报考节点，不是硬门槛；
                    名声、学科与票证凑齐就能考。
                  </p>
                </section>

                <section className="sheet-sec">
                  <h3>核心特技（培养目标）</h3>
                  {d.core.length > 0 ? (
                    <ul className="skill-list">
                      {d.core.map((s) => (
                        <li key={s.n}>
                          <b>{s.n}</b>
                          <span>{s.d}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">暂无。</p>
                  )}
                </section>
              </>
            )}

            {tab === "bond" && (
              <>
                <section className="sheet-sec">
                  <h3>
                    最爱礼物 <b>{d.gifts.bestCount} 件</b>
                    <span className="sheet-note">按好感度排序，列前 {d.gifts.best.length} 件</span>
                  </h3>
                  <div className="gift-grid">
                    {d.gifts.best.map((g) => (
                      <div className="gift" key={g.n}>
                        <span className="gift-name">{g.n}</span>
                        <span className="gift-meta">
                          {g.c} · {g.p}
                        </span>
                        <b className="gift-v">{g.v}</b>
                      </div>
                    ))}
                  </div>
                </section>

                {d.gifts.like.length > 0 && (
                  <section className="sheet-sec">
                    <h3>
                      喜欢礼物 <b>{d.gifts.likeCount} 件</b>
                      <span className="sheet-note">列前 {d.gifts.like.length} 件</span>
                    </h3>
                    <div className="gift-grid">
                      {d.gifts.like.map((g) => (
                        <div className="gift" key={g.n}>
                          <span className="gift-name">{g.n}</span>
                          <span className="gift-meta">
                            {g.c} · {g.p}
                          </span>
                          <b className="gift-v">{g.v}</b>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="sheet-sec">
                  <h3>
                    支援对象 <b>{d.supports.items.length} 人</b>
                    {d.supports.meta && <span className="sheet-note">{d.supports.meta}</span>}
                  </h3>
                  {rankGroups.length > 0 ? (
                    <div className="sup-groups">
                      {rankGroups.map((g) => (
                        <div className="sup-group" key={g.r}>
                          <span className={`sup-rank sup-${g.r}`}>{g.r}</span>
                          <span className="sup-names">
                            {g.items.map((s) => (
                              <span className="sup-name" key={s.n} title={s.e ? "有配对结局" : ""}>
                                {s.n}
                                {s.e && <i>★</i>}
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">暂无支援数据。</p>
                  )}
                  <p className="sheet-foot-note">★ = 已确认有配对结局。送礼与共餐都能涨支援。</p>
                </section>
              </>
            )}

            {tab === "bio" && (
              <>
                <section className="sheet-sec">
                  <h3>简介</h3>
                  <p className="bio-intro">{d.bio.intro || "暂无简介。"}</p>
                  {Object.keys(d.bio.facts).length > 0 && (
                    <dl className="bio-facts">
                      {Object.entries(d.bio.facts).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
                <section className="sheet-sec">
                  <h3>怎么拿到</h3>
                  <div className="sheet-recruit">
                    {ROUTES.map((r) => {
                      const rel = current.rel[r.key];
                      if (!rel) return null;
                      const state = rel === "初始加入" ? "own" : rel === "可挖角" ? "can" : "no";
                      return (
                        <span key={r.key} className={`recruit-line ${state}`}>
                          <b>{r.key}线</b>
                          {rel}
                        </span>
                      );
                    })}
                    {current.later && <span className="recruit-line later">{current.later}</span>}
                  </div>
                </section>
              </>
            )}

            <p className="sheet-foot-note">
              数值、特技、礼物、支援与立绘整理自 annasnotebook.net，版权归任天堂 / Intelligent Systems。
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
