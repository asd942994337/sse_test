import { useState, type FormEvent } from "react";
import { changePassword, type AuthUser } from "../api";

export function Settings({ user }: { user: AuthUser }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setMsg({ ok: false, text: "两次输入的新密码不一致" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await changePassword(current, next);
      setMsg({ ok: true, text: "密码已修改，其它设备上的登录已失效" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">SETTINGS</p>
        <h1 className="hero-title">账号设置</h1>
        <p className="hero-sub">
          当前账号：<b>{user.username}</b>（{user.role === "admin" ? "管理员" : "普通用户"}）
        </p>
      </header>

      <section className="panel" style={{ maxWidth: 460 }}>
        <div className="panel-head">
          <h2>修改密码</h2>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <label>
            当前密码
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            新密码（至少 8 位）
            <input
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            再输一次
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {msg && (
            <p className={msg.ok ? "login-ok" : "login-error"}>{msg.text}</p>
          )}

          <button className="btn btn-primary login-btn" disabled={busy}>
            {busy ? "提交中…" : "修改密码"}
          </button>
        </form>
      </section>
    </main>
  );
}
