/**
 * 临时自测：直接调 RAG 的三个服务，不经过 Nest（避开数据库重试等待）。
 * 用完删除。
 */
process.chdir(__dirname);

const path = require('node:path');
const { KnowledgeService } = require('./dist/rag/knowledge.service');
const { WebService } = require('./dist/rag/web.service');
const { RagService } = require('./dist/rag/rag.service');

const fakeDb = { ready: false, db: null };

(async () => {
  let fail = 0;
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n   → ${detail}`}`);
    if (!ok) fail++;
  };

  // ── 1. 本地检索（content.js 兜底）──
  console.log('\n=== 本地检索（数据库不可用 → content.js）===');
  const ks = new KnowledgeService(fakeDb);
  const stats = await ks.stats();
  console.log('   知识库:', JSON.stringify(stats));
  check('知识库有数据', stats.guides > 100, JSON.stringify(stats));

  for (const q of ['影之刃零 第一章', '火纹 角色梯度', '时之笛 成年篇']) {
    const hits = await ks.search(q, 3);
    console.log(`   Q「${q}」→ ${hits.length} 条`);
    hits.forEach((h) => console.log(`      ${h.score}  ${h.game} · ${h.section} · ${h.title}`));
    check(`「${q}」有命中`, hits.length > 0);
  }

  // ── 2. 联网搜索 + 抓正文 ──
  console.log('\n=== 联网搜索（Bing RSS，免 key）===');
  const web = new WebService();
  const ws = await web.search('影之刃零 攻略', { maxResults: 3, fetchPages: 2 });
  console.log(`   拿到 ${ws.length} 条`);
  ws.forEach((h) => console.log(`      ${h.title.slice(0, 40)} | 正文 ${h.content.length} 字 ${h.error || ''}`));
  check('搜索结果非空', ws.length > 0);
  check('至少抓到一个网页正文', ws.some((h) => h.content.length > 100), ws.map((h) => h.error).join(','));

  // ── 3. 完整流程（未配模型 → 列资料兜底）──
  console.log('\n=== 完整流程（未配 LLM_API_KEY）===');
  delete process.env.LLM_API_KEY;
  const rag = new RagService(ks, web);

  const modeOf = async (q, mode) => {
    let text = '';
    const events = [];
    for await (const e of rag.stream(q, { mode })) {
      events.push(e.type);
      if (e.type === 'delta') text += e.data.text;
      if (e.type === 'sources') {
        console.log(`   [${mode}] 站内 ${e.data.local.length} 条 / 网络 ${e.data.web.length} 条`);
      }
    }
    return { text, events };
  };

  const localOnly = await modeOf('影之刃零 第一章怎么打', 'local');
  check('local 模式不联网', localOnly.events.includes('sources') && !localOnly.text.includes('联网找到'));

  const forced = await modeOf('影之刃零 第一章怎么打', 'web');
  check('web 模式强制联网', forced.text.includes('联网找到') || forced.text.includes('网络'), forced.text.slice(0, 100));

  const auto = await modeOf('影之刃零 第一章怎么打', 'auto');
  console.log('   auto 输出前 120 字:', auto.text.slice(0, 120).replace(/\n/g, ' '));
  check('auto 模式能给出站内答案', auto.text.includes('站内攻略命中'), auto.text.slice(0, 120));

  const unknown = await modeOf('完全不相干的量子力学问题 xyz123', 'auto');
  check('站内没有时会自动联网', unknown.text.includes('联网找到') || unknown.events.includes('sources'),
    unknown.text.slice(0, 150));

  console.log(`\n${fail ? fail + ' 项失败' : '全部通过'}`);
  process.exit(fail ? 1 : 0);
})();
