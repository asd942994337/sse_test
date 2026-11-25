#!/usr/bin/env node
/**
 * 内容体检：部署前跑一遍，避免脏数据进库。
 *
 *   node scripts/check-content.mjs
 *
 * 错误（会退出 1）：
 *   · game 缺字段 / slug 重复
 *   · guide 的 game 不存在、缺 section/title、body 为空
 *   · kind 不是 flow / quest / collect / system
 *   · 同一个游戏内 key 重复（只检查写了 key 的条目）
 *
 * 警告（不阻塞）：
 *   · 条目没写 key（老内容，会用 s+sort 兜底）
 *   · body 偏短（可能是分隔条/占位）
 *   · 同游戏内标题重复
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { games, guides } = require('../content.js');

const KIND_OK = new Set(['flow', 'quest', 'collect', 'system']);
const errors = [];
const warnings = [];
const noKey = new Map();
const shortBody = new Map();
const dupTitle = new Map();

const slugs = new Set();
for (const g of games) {
  if (!g.slug) errors.push(`game 缺 slug: ${JSON.stringify(g)}`);
  if (slugs.has(g.slug)) errors.push(`game slug 重复: ${g.slug}`);
  slugs.add(g.slug);
  for (const f of ['title', 'subtitle', 'platform', 'accent', 'summary']) {
    if (!g[f]) errors.push(`game ${g.slug} 缺字段 ${f}`);
  }
}

const keys = new Map();
const counts = new Map();
const titles = new Set();
const sepLike = /^(—|本章总览|覆盖说明|⚠️|方块目标|.*目标\s*\d*$)/;

for (const it of guides) {
  const where = `${it.game} / ${it.title || '(无标题)'}`;
  if (!slugs.has(it.game)) errors.push(`${where}: game 不存在`);
  if (!it.section) errors.push(`${where}: 缺 section`);
  if (!it.title) errors.push(`${where}: 缺 title`);
  if (!it.body || !it.body.trim()) errors.push(`${where}: body 为空`);
  if (it.kind && !KIND_OK.has(it.kind)) errors.push(`${where}: kind 非法 ${it.kind}`);

  if (it.key) {
    const k = `${it.game}:${it.key}`;
    if (keys.has(k)) errors.push(`key 重复: ${k}（${keys.get(k)} 与 ${it.title}）`);
    keys.set(k, it.title);
  } else {
    noKey.set(it.game, (noKey.get(it.game) || 0) + 1);
  }

  if (it.body && it.body.trim().length < 50 && !sepLike.test(it.title || '')) {
    shortBody.set(it.game, (shortBody.get(it.game) || 0) + 1);
  }

  counts.set(it.game, (counts.get(it.game) || 0) + 1);

  const t = `${it.game}:${it.title}`;
  if (titles.has(t)) dupTitle.set(it.game, (dupTitle.get(it.game) || 0) + 1);
  titles.add(t);
}

console.log('内容统计：');
for (const g of games) {
  console.log(`  ${g.slug.padEnd(28)} ${String(counts.get(g.slug) || 0).padStart(4)} 条`);
}
console.log(`  合计 ${guides.length} 条\n`);

for (const [game, n] of noKey) warnings.push(`${game}: ${n} 条没写 key（用 s+sort 兜底）`);
for (const [game, n] of shortBody) warnings.push(`${game}: ${n} 条 body 偏短（<50 字）`);
for (const [game, n] of dupTitle) warnings.push(`${game}: ${n} 条标题重复`);

if (warnings.length) {
  console.log(`警告 ${warnings.length} 类：`);
  for (const w of warnings) console.log('  ⚠ ' + w);
  console.log('');
}

if (errors.length) {
  console.error(`错误 ${errors.length} 条：`);
  for (const e of errors.slice(0, 30)) console.error('  ✗ ' + e);
  if (errors.length > 30) console.error(`  … 还有 ${errors.length - 30} 条`);
  process.exit(1);
}

console.log('✓ 内容体检通过（警告不阻塞）');
