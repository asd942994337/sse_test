/**
 * 攻略站内容入口
 *
 * games —— 游戏卡片
 * guides —— 各游戏条目，按游戏拆到独立文件
 *
 *   影之刃零：content-pbz.js —— 按章节融合（主线+支线+收集）
 *   时之笛：  content-oot.js —— 开始之前 / 阶段流程 / 幼年 / 成年 / 支线 / 收集 / 速查
 *   万缕千丝：content-fe.js  —— 方尖塔 / 日程 / 战斗 / 成长 / 角色 / 招募 / 外传 / 流程
 *   法环：    content-er.js  —— 区域流程 / Boss / 支线 / 收集 / 构筑（含轮椅法师）
 *   PoE2：    content-poe2.js —— 1.0 征服者：前瞻 / 开荒 / 终局 / 构筑 / 速查
 *   暗黑4：   content-d4.js   —— S16 泰瑞尔的赌注：前瞻 / 开荒 / 终局 / 构筑 / 速查
 *
 * 种子按 key（没有 key 时退回 s+sort）upsert，改文案重新部署即可，进度不会丢；
 * 不在内容表里的旧条目会在 seed 时被清理，避免改版后出现重复。
 */

const games = [
  {
    slug: "phantom-blade-zero",
    title: "影之刃零",
    subtitle: "Phantom Blade Zero",
    platform: "PS5 / PC",
    year: 2026,
    accent: "#c8102e",
    sort: 1,
    summary:
      "功夫朋克动作游戏，2026-10-29 发售。按 9 个章节整合主线、支线与收集品位置，每章一条流程 + 一张收集清单。",
  },
  {
    slug: "ocarina-of-time",
    title: "塞尔达传说：时之笛",
    subtitle: "Ocarina of Time · Switch 2 重制版",
    platform: "Nintendo Switch 2",
    year: 2026,
    accent: "#4f8f5f",
    sort: 2,
    summary:
      "Switch 2 重制版，2026-11-05 发售，容量 27GB。七阶段全流程 + 八座迷宫逐关要点 + 支线与收集清单。按重制版操作改写：没有自动跳跃，跳跃/冲刺是独立键。",
  },
  {
    slug: "fire-emblem-fortunes-weave",
    title: "火焰纹章：万缕千丝",
    subtitle: "Fire Emblem: Fortune's Weave",
    platform: "Nintendo Switch 2",
    year: 2026,
    accent: "#c9a227",
    sort: 3,
    summary:
      "2026-09-17 发售。四条主角线并行 + 日程回合制 + 消耗 HP 的烈焰技。46 条：四线对照、角色岗位与强度梯队、全员挖角条件、9 个外传窗口与打法、前期组队与考试节奏、第二/三部流程。",
  },
  {
    slug: "elden-ring",
    title: "艾尔登法环",
    subtitle: "Elden Ring · 黄金树幽影",
    platform: "PS5 / Xbox / PC",
    year: 2022,
    accent: "#c8a24a",
    sort: 4,
    summary:
      "本体 + DLC《黄金树幽影》。区域顺序、主线 Boss、支线与收集；「轮椅法师」四篇：分阶段路线、12 步执行清单、道具位置、配装与实战循环。另附「怕老鼠」方案（PC 换模型、主机给规避路线）。",
  },
  {
    slug: "path-of-exile-2",
    title: "流放之路2",
    subtitle: "Path of Exile 2 · 1.0 瓦尔克拉斯征服者",
    platform: "PC / PS5 / Xbox",
    year: 2026,
    accent: "#8b5cf6",
    sort: 5,
    summary:
      "1.0 正式版 2026-12-11 上线（国服 12-18），免费。新职业暗影/决斗者、第五六章、Atlas 精简到 70 点；赛季「瓦尔克拉斯征服者」招兵建城堡、三阵营抢地盘。含开荒路线、终局与构筑框架。",
  },
  {
    slug: "diablo-4",
    title: "暗黑破坏神4",
    subtitle: "Diablo IV · S16 泰瑞尔的赌注",
    platform: "PC / PS5 / Xbox",
    year: 2023,
    accent: "#a83232",
    sort: 6,
    summary:
      "S16《泰瑞尔的赌注》2026-12-01 开季，补丁 3.3.0。双收割者、战争计划两棵树、霍拉德里克物品、地狱狂潮常驻；含 1–60 开荒、苦痛/深渊/巢穴 Boss 与防御层次。",
  },
];

const pbzGuides = require("./content-pbz");
const ootGuides = require("./content-oot");
const feGuides = require("./content-fe");
const erGuides = require("./content-er");
const poe2Guides = require("./content-poe2");
const d4Guides = require("./content-d4");

module.exports = {
  games,
  guides: [...pbzGuides, ...ootGuides, ...feGuides, ...erGuides, ...poe2Guides, ...d4Guides],
};
