import { useState } from "react";
import { postEcho } from "../api";

export function EchoPanel() {
  const [output, setOutput] = useState("点右上按钮，看看请求体和返回。");
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    setOutput("请求中…");
    try {
      const data = await postEcho();
      setOutput(JSON.stringify(data, null, 2));
    } catch (err) {
      setOutput(`请求失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>POST 回声</h2>
        <button className="btn btn-ghost" onClick={onClick} disabled={busy}>
          发一个 POST
        </button>
      </div>
      <pre className="code">{output}</pre>
    </section>
  );
}
