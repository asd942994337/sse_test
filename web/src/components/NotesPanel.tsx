import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addNote, deleteNote, getNotes, updateNote, type Note } from "../api";

export function NotesPanel({ tick }: { tick: number }) {
  const [items, setItems] = useState<Note[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getNotes();
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tick]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await addNote(content);
      setText("");
      setHint("");
      await load();
    } catch (err) {
      setHint(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(note: Note) {
    // 先改本地状态（乐观更新），失败再回滚——用户会觉得"点一下就响应"
    setItems((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, done: n.done ? 0 : 1 } : n))
    );
    try {
      await updateNote(note.id, { done: !note.done });
    } catch (err) {
      setHint(`更新失败：${(err as Error).message}`);
      await load();
    }
  }

  async function onDelete(id: number) {
    try {
      await deleteNote(id);
      await load();
    } catch (err) {
      setHint(`删除失败：${(err as Error).message}`);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>便签</h2>
        <span className={`badge ${error ? "bad" : "ok"}`}>
          {error ? "数据库不可用" : `MySQL 已连接 · ${total} 条`}
        </span>
      </div>

      <form className="add-row" onSubmit={onSubmit} autoComplete="off">
        <input
          className="input"
          maxLength={500}
          placeholder="写点什么，回车保存（会真正写进 MySQL）"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
          添加
        </button>
      </form>

      <ul className="notes">
        {error ? (
          <li className="note empty">{error}</li>
        ) : items.length === 0 ? (
          <li className="note empty">还没有数据，在上面写一条试试</li>
        ) : (
          items.map((n) => (
            <li className={`note ${n.done ? "done" : ""}`} key={n.id}>
              <input
                type="checkbox"
                className="check"
                checked={Boolean(n.done)}
                onChange={() => onToggle(n)}
                title="标记完成"
              />
              <span className="text">{n.content}</span>
              <time>{String(n.created_at).replace("T", " ").slice(0, 19)}</time>
              <button className="del" onClick={() => onDelete(n.id)} title="删除">
                删除
              </button>
            </li>
          ))
        )}
      </ul>

      <p className="muted">
        {hint || "数据存在 MySQL 里：重建容器、重启服务都不会丢（试试 docker compose restart api）"}
      </p>
    </section>
  );
}
