import { useState, type FormEvent } from "react";
import { login, type AuthUser } from "../api";

export function Login({ needSetup, onDone }: { needSetup: boolean; onDone: (u: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || needSetup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await login(username.trim(), password);
      onDone(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (needSetup) {
    return (
      <main className="wrap login-wrap">
        <div className="login-card">
          <p className="eyebrow">PRIVATE ARCHIVE</p>
          <h1 className="login-title">还没有账号</h1>
          <p className="login-sub">
            自助注册已关闭。请在服务器上为容器设置两个环境变量后重启：
            <br />
            <code>ADMIN_USER</code> 与 <code>ADMIN_PASSWORD</code>，
            <br />
            启动时会自动创建第一个管理员。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap login-wrap">
      <div className="login-card">
        <p className="eyebrow">PRIVATE ARCHIVE</p>
        <h1 className="login-title">登录</h1>
        <p className="login-sub">攻略档案是私人的，登录后才会加载数据</p>

        <form onSubmit={onSubmit} className="login-form">
          <label>
            用户名
            <input
              className="input"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="btn btn-primary login-btn" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </main>
  );
}
