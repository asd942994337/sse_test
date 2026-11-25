import { useCallback, useEffect, useState } from "react";
import {
  adminCleanup,
  adminCreateUser,
  adminDeleteUser,
  adminEvents,
  adminMeta,
  adminOverview,
  adminUpdateUser,
  adminUsers,
  type AdminEvent,
  type AdminOverview,
  type AdminUser,
  type AuthUser,
} from "../api";

type Tab = "overview" | "events" | "users";

/**
 * 管理后台。
 *
 * 设计取舍：
 *   · 先做**表格 + 数字**，不做图表 —— 数据量小的时候，表格看得更快。
 *     等你知道自己真正每天想看什么，再挑那两三个指标画图。
 *   · 全部只读聚合，唯一的写操作是用户管理，且都由 AdminGuard 拦在接口层。
 */
export function AdminPage({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">ADMIN</p>
        <h1 className="hero-title">管理后台</h1>
        <p className="hero-sub">
          当前账号：<b>{user.username}</b>（管理员）。这里看到的是匿名统计，不含可识别到人的信息。
        </p>
      </header>

      <div className="admin-tabs">
        <button className={`btn ${tab === "overview" ? "btn-primary" : ""}`} onClick={() => setTab("overview")}>
          概览
        </button>
        <button className={`btn ${tab === "events" ? "btn-primary" : ""}`} onClick={() => setTab("events")}>
          事件明细
        </button>
        <button className={`btn ${tab === "users" ? "btn-primary" : ""}`} onClick={() => setTab("users")}>
          用户
        </button>
      </div>

      {tab === "overview" && <Overview />}
      {tab === "events" && <Events />}
      {tab === "users" && <Users me={user} />}
    </main>
  );
}

/* ========================================================================== */
/*  概览                                                                       */
/* ========================================================================== */
function Overview() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [meta, setMeta] = useState<{ telemetry: any; dbReady: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d: number) => {
    setBusy(true);
    setErr(null);
    try {
      const [ov, m] = await Promise.all([adminOverview(d), adminMeta()]);
      setData(ov);
      setMeta(m as any);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <>
      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>今天</h2>
          <div className="admin-row">
            {[7, 30].map((d) => (
              <button key={d} className={`btn ${days === d ? "btn-primary" : ""}`} onClick={() => setDays(d)}>
                近 {d} 天
              </button>
            ))}
            <button className="btn" onClick={() => void load(days)} disabled={busy}>
              {busy ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        {err && <p className="login-error">{err}</p>}

        {data && (
          <div className="grid">
            <Kpi k="浏览量 PV" v={data.today.pv} />
            <Kpi k="访客 UV" v={data.today.uv} />
            <Kpi k="搜索次数" v={data.today.searches} />
            <Kpi k="问答次数" v={data.today.chats} />
            <Kpi k="报错" v={data.today.errors} warn={data.today.errors > 0} />
          </div>
        )}

        {meta && (
          <p className="admin-note">
            采集队列 {meta.telemetry.queued} 条待写 · 已写入 {meta.telemetry.written} 条
            {meta.telemetry.dropped > 0 ? ` · 丢弃 ${meta.telemetry.dropped} 条（队列满）` : ""} ·
            数据库{meta.dbReady ? "正常" : "未就绪"}
          </p>
        )}
      </div>

      {data && data.trend.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>访问趋势</h2>
            <span className="admin-note">近 {days} 天</span>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>日期</th>
                <th className="num">PV</th>
                <th className="num">UV</th>
                <th>分布</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((r) => {
                const max = Math.max(...data.trend.map((x) => x.pv), 1);
                return (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td className="num">{r.pv}</td>
                    <td className="num">{r.uv}</td>
                    <td>
                      <span className="admin-bar" style={{ width: `${Math.round((r.pv / max) * 100)}%` }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-cols">
        <div className="panel">
          <div className="panel-head">
            <h2>搜索词</h2>
            <span className="admin-note">标红 = 一条都没搜到</span>
          </div>
          {data && data.searches.length > 0 ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>关键词</th>
                  <th className="num">次数</th>
                  <th className="num">零结果</th>
                </tr>
              </thead>
              <tbody>
                {data.searches.map((s) => (
                  <tr key={s.word} className={s.zero >= s.n ? "zero" : ""}>
                    <td>{s.word}</td>
                    <td className="num">{s.n}</td>
                    <td className="num">{s.zero || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="admin-note">还没有搜索数据。这些数字要等你用一会儿站才会出现。</p>
          )}
          {data && data.searches.length > 0 && (
            <p className="admin-note">
              零结果最多的词，说明你的库里缺这块内容 —— 比任何 PV 数字都值得处理。
            </p>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>热门内容</h2>
          </div>
          {data && data.guides.length > 0 ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>目标</th>
                  <th className="num">打开</th>
                </tr>
              </thead>
              <tbody>
                {data.guides.map((g) => (
                  <tr key={g.target}>
                    <td>{g.target}</td>
                    <td className="num">{g.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="admin-note">还没有内容打开记录。</p>
          )}
        </div>
      </div>

      {data && (
        <div className="admin-cols">
          <div className="panel">
            <div className="panel-head">
              <h2>问答</h2>
            </div>
            <div className="grid">
              <Kpi k="回答次数" v={data.chat.n} />
              <Kpi k="平均耗时" v={data.chat.avgMs ? `${data.chat.avgMs} ms` : "—"} />
              <Kpi k="平均首字" v={data.chat.avgTtfb ? `${data.chat.avgTtfb} ms` : "—"} />
              <Kpi k="触发联网" v={data.chat.webCalls} />
            </div>
            <table className="admin-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>问题</th>
                  <th>模式</th>
                </tr>
              </thead>
              <tbody>
                {data.questions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="admin-note">
                      还没有提问记录。
                    </td>
                  </tr>
                )}
                {data.questions.map((q, i) => (
                  <tr key={i}>
                    <td className="nowrap">{String(q.ts).slice(5, 19).replace("T", " ")}</td>
                    <td>{q.question}</td>
                    <td>{q.mode || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>报错</h2>
              <span className="admin-note">接口 4xx/5xx 与前端异常</span>
            </div>
            {data.errors.length > 0 ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>位置</th>
                    <th className="num">次数</th>
                    <th>最近</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((e, i) => (
                    <tr key={i} className="zero">
                      <td>{e.target || e.path}</td>
                      <td className="num">{e.n}</td>
                      <td className="nowrap">{String(e.lastAt).slice(5, 19).replace("T", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="admin-note">没有报错。</p>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>维护</h2>
        </div>
        <p className="admin-note">
          埋点表只会变大。建议每季度清一次，保留最近 90 天。
        </p>
        <button
          className="btn"
          onClick={async () => {
            if (!confirm("删除 90 天前的事件？此操作不可撤销。")) return;
            try {
              const r = await adminCleanup(90);
              alert(`已删除 ${r.deleted} 条`);
              void load(days);
            } catch (e) {
              alert((e as Error).message);
            }
          }}
        >
          清理 90 天前的事件
        </button>
      </div>
    </>
  );
}

function Kpi({ k, v, warn }: { k: string; v: number | string; warn?: boolean }) {
  return (
    <div className="card" style={warn ? { borderColor: "var(--bad)" } : undefined}>
      <div className="k">{k}</div>
      <div className="v" style={warn ? { color: "var(--bad)" } : undefined}>
        {v}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  事件明细                                                                   */
/* ========================================================================== */
function Events() {
  const [kind, setKind] = useState("");
  const [days, setDays] = useState(7);
  const [items, setItems] = useState<AdminEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const limit = 50;

  const load = useCallback(
    async (k: string, d: number, off: number) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await adminEvents({ kind: k || undefined, days: d, limit, offset: off });
        setItems(r.items);
        setTotal(r.total);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(kind, days, offset);
  }, [kind, days, offset, load]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>事件明细</h2>
        <div className="admin-row">
          <select
            className="input"
            value={kind}
            onChange={(e) => {
              setOffset(0);
              setKind(e.target.value);
            }}
          >
            <option value="">全部类型</option>
            {["page_view", "search", "guide_open", "guide_done", "chat_ask", "chat_done", "api", "error"].map(
              (k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              )
            )}
          </select>
          <select
            className="input"
            value={days}
            onChange={(e) => {
              setOffset(0);
              setDays(Number(e.target.value));
            }}
          >
            <option value={1}>今天</option>
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
          </select>
        </div>
      </div>

      {err && <p className="login-error">{err}</p>}
      <p className="admin-note">共 {total} 条{busy ? " · 加载中…" : ""}</p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>目标</th>
            <th>路径</th>
            <th>附加</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{String(e.ts).slice(5, 19).replace("T", " ")}</td>
              <td>{e.kind}</td>
              <td>{e.target || "—"}</td>
              <td className="nowrap">{e.path}</td>
              <td className="props">{e.props ? JSON.stringify(e.props).slice(0, 90) : ""}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="admin-note">
                这个条件下没有事件。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="admin-row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          上一页
        </button>
        <span className="admin-note">
          {offset + 1} - {Math.min(offset + limit, total)} / {total}
        </span>
        <button
          className="btn"
          disabled={offset + limit >= total}
          onClick={() => setOffset(offset + limit)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  用户管理                                                                   */
/* ========================================================================== */
function Users({ me }: { me: AuthUser }) {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pwd, setPwd] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminUsers();
      setItems(r.items);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await adminCreateUser(name.trim(), pwd, role);
      setName("");
      setPwd("");
      setRole("user");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>新增账号</h2>
        </div>
        {err && <p className="login-error">{err}</p>}
        <div className="admin-row">
          <input className="input" placeholder="用户名" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input"
            type="password"
            placeholder="密码（至少 8 位）"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
          <button className="btn btn-primary" onClick={create} disabled={busy || !name || pwd.length < 8}>
            创建
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>账号列表</h2>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th className="num">在线会话</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td className="num">{u.id}</td>
                <td>
                  {u.username}
                  {u.id === me.id ? "（你）" : ""}
                </td>
                <td>{u.role === "admin" ? "管理员" : "普通用户"}</td>
                <td className="num">{u.sessions}</td>
                <td className="nowrap">{String(u.created_at).slice(0, 10)}</td>
                <td>
                  <div className="admin-row">
                    <select
                      className="input"
                      value={u.role}
                      disabled={u.id === me.id}
                      onChange={async (e) => {
                        try {
                          await adminUpdateUser(u.id, { role: e.target.value });
                          await load();
                        } catch (err) {
                          alert((err as Error).message);
                          await load();
                        }
                      }}
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                    <button
                      className="btn"
                      onClick={async () => {
                        const p = prompt(`给 ${u.username} 设置新密码（至少 8 位）`);
                        if (!p) return;
                        try {
                          await adminUpdateUser(u.id, { password: p });
                          alert("已修改，该账号的所有登录已失效");
                          await load();
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}
                    >
                      改密码
                    </button>
                    <button
                      className="btn"
                      disabled={u.id === me.id}
                      onClick={async () => {
                        if (!confirm(`删除账号 ${u.username}？`)) return;
                        try {
                          await adminDeleteUser(u.id);
                          await load();
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
