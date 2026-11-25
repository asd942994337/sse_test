import { useEffect, useState, type FormEvent } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Home } from "./pages/Home";
import { GuidePage } from "./pages/GuidePage";
import { CharactersPage } from "./pages/CharactersPage";
import { SearchPage } from "./pages/SearchPage";
import { SystemPage } from "./pages/SystemPage";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { AdminPage } from "./pages/AdminPage";
import { authMe, authStatus, logout, type AuthUser } from "./api";
import { trackPageView } from "./lib/track";

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needSetup, setNeedSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  // 埋点：每次换路由记一条 page_view（放最前面，保证 hooks 顺序稳定）
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await authStatus();
        if (!alive) return;
        setNeedSetup(st.needSetup);
        if (!st.needSetup) {
          const me = await authMe();
          if (alive) setUser(me.user);
        }
      } catch {
        /* 未登录 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    navigate(`/search?q=${encodeURIComponent(text)}`);
    setQ("");
  }

  async function onLogout() {
    await logout().catch(() => {});
    setUser(null);
    navigate("/");
  }

  if (loading) {
    return (
      <main className="wrap">
        <p className="loading">检查登录状态…</p>
      </main>
    );
  }

  if (!user) {
    return <Login needSetup={needSetup} onDone={(u) => setUser(u)} />;
  }

  return (
    <>
      <nav className="topbar">
        <Link to="/" className="brand">
          影<span>·</span>档
        </Link>

        <form className="topbar-search" onSubmit={onSubmit}>
          <input
            className="topbar-input"
            placeholder="搜索攻略…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>

        <div className="topbar-links">
          <Link to="/">攻略</Link>
          <Link to="/characters">图鉴</Link>
          <Link to="/search">查询</Link>
          {/* 聊天页由 api 容器单独提供（nginx /chat），是独立页面，
              所以这里必须用 <a> 走整页跳转，不能用 react-router 的 <Link> */}
          <a href="/chat/" className="topbar-ai" title="AI 攻略助手 —— 问一句就答">
            问一问
          </a>
          <Link to="/system">系统</Link>
          {/* 只有管理员才看得到；真正的权限在接口层（AdminGuard），
              这里隐藏只是体验，不是安全边界 */}
          {user.role === "admin" && (
            <Link to="/admin" className="topbar-admin">
              后台
            </Link>
          )}
          <Link to="/settings">设置</Link>
          <button className="topbar-user" onClick={onLogout} title="点击退出">
            {user.username} · 退出
          </button>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/g/:slug" element={<GuidePage />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route
          path="/admin"
          element={user.role === "admin" ? <AdminPage user={user} /> : <Home />}
        />
        <Route path="/settings" element={<Settings user={user} />} />
        <Route path="*" element={<Home />} />
      </Routes>

      <footer className="site-foot">
        <span>个人攻略档案 · 边玩边记</span>
        <span>六款作品 · 条目随版本更新</span>
      </footer>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
