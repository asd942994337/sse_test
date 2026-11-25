# 站内知识库 + 联网搜索（RAG）

给 hello-stack 加一个「先查站内，查不到再联网」的问答接口。

```
用户提问
  → 站内检索（MySQL / content.js）
  → 路由判定：够不够？
      · 够 → 只用站内
      · 不够 / 用户点了「联网」→ 补一次网络搜索
  → 拼成上下文 → 模型作答（带引用编号）
  → SSE 流式吐给前端
```

## 落地文件

```
src/rag/
├── knowledge.service.ts   站内检索：MySQL 为主，content.js 兜底 + 打分
├── web.service.ts         联网：Bing RSS 搜索 + 网页正文抽取
├── rag.service.ts         编排：路由 → 提示词 → 流式调用模型
├── rag.controller.ts      POST /api/rag/chat（SSE）
└── rag.module.ts
public/index.html          聊天页（/chat）
```

`src/app.module.ts` 注册了模块，`src/main.ts` 挂载了静态页。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/rag/info` | 知识库条数、模型是否已配、自动联网阈值 |
| POST | `/api/rag/chat` | 提问，返回 `text/event-stream` |

请求体：

```json
{
  "question": "影之刃零 第一章怎么打",
  "mode": "auto",          // auto | local | web
  "history": [{ "role": "user", "content": "…" }]
}
```

三种 `mode` 的区别：

| mode | 站内检索 | 联网 | 用在哪 |
|---|---|---|---|
| `local` | ✅ | ❌ | 「只查站内」 |
| `web` | ✅ | ✅ 一定联网 | 「联网」按钮 |
| `auto` | ✅ | 分数低于阈值才联 | 默认 |

注意 `web` 不是「只联网」，而是「站内也查、另外再上网」——
站内资料永远优先，网上的是补充。这跟 DeepSeek 网页版那个「联网搜索」开关的语义一致。

响应是一串 SSE 事件：

```
event: stage     data: {"step":"local","text":"正在检索站内攻略…"}
event: sources   data: {"local":[...],"web":[...],"usedWeb":false}
event: stage     data: {"step":"llm","text":"正在整理答案…"}
event: delta     data: {"text":"第一章"}
event: done      data: {"ms":3200,"chars":180,"usedWeb":false}
event: error     data: {"message":"…"}
```

**为什么用 POST + SSE 而不是 `EventSource`**：聊天要把整段对话放 body 里，
`EventSource` 只能 GET、带不了 body。SSE 只是响应格式，POST 一样能返回，
前端用 `fetch` + `ReadableStream` 自己按行解析（见 `public/index.html`）。

## 配置

全是环境变量，不填也能跑（只是没模型时会直接把资料列给你）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | 任何 OpenAI 兼容网关 |
| `LLM_API_KEY` | 空 | 填了才会真正调用模型 |
| `LLM_MODEL` | `deepseek-chat` | 模型名 |
| `RAG_MIN_SCORE` | `4` | 站内分数低于它就自动联网 |
| `RAG_AUTO_WEB` | `1` | 设 `0` 关掉自动联网，只能手动点「联网」 |
| `RAG_SYSTEM_PROMPT` | 空 | 覆盖内置系统提示词 |

## 站内检索怎么打分

权重：**游戏名 8** > 标题 5 > 标签 3 > 分区 2 > 正文 1~2.2（出现次数封顶）。

游戏名必须算分，而且最重 —— 这是踩出来的坑：

> 一开始只按标题/正文打分，问「影之刃零 第一章」返回的全是火焰纹章的条目。
> 因为「第一」「一章」这种通用 bigram 在火纹内容里到处都是，把分数吸光了。
> 把 `games.title` 纳入打分并给最高权重后，结果立刻正确。

中文没有分词器，用 **bigram** 近似（「影之刃零」→ 影之 / 之刃 / 刃零），
比整句 LIKE 更能召回换过措辞的段落。

**暂时没用 MySQL 全文索引**：默认分词器切不了中文，要 `WITH PARSER ngram`
并额外建索引。对现在几百条攻略，LIKE + 自研打分完全够用，而且不改你的表结构。
条目上到几千条再换：

```sql
ALTER TABLE guides ADD FULLTEXT INDEX ft_guides (title, body) WITH PARSER ngram;
```

然后把 `searchDb()` 换成 `MATCH(title,body) AGAINST(? IN NATURAL LANGUAGE MODE)`，
其它代码不用动。

## 联网部分

### 首选：DeepSeek 官方网页搜索（不花钱、不用注册）

DeepSeek 的 API 除了对话，还带了两个工具接口：

| 接口 | 作用 |
|---|---|
| `POST /v1/tools/search` | 按 query 搜索，返回结构化结果 |
| `POST /v1/tools/fetch` | 抓网页，返回标题 + Markdown 正文 |

**和对话用同一把 key、同一个 base_url**，所以只要配了模型，联网这块零额外配置。

而且它的返回就是为 LLM 设计的：

```json
{ "results": [{
    "rerank_score": 2.4,        // 0~3，≥1.5 算优质结果
    "title": "...", "url": "...",
    "snippet": "100~200 字，给前端展示",
    "summary": "600~800 字，给模型阅读",   ← 我们直接用它当正文
    "authority": 3,             // 0~4，≥3 极权威
    "content": "",              // need_content=true 才有全文
    "site_name": "...", "date": "..."
}]}
```

所以本项目的处理是：

- `content = content || summary` —— 直接用官方给的长摘要，**省掉一次网页抓取**
- 按 `rerank_score` 降序，**丢掉 < 1 分的**
- 把用户原话通过 `ori_question` 传进去，帮助理解意图

配置（弹窗里选一下就行）：

```bash
SEARCH_PROVIDER=deepseek     # 不填也行：检测到 base_url 是 deepseek 就自动用它
```

### 备选：第三方搜索 API

要换别家，`SEARCH_PROVIDER` 支持 `tavily` / `brave` / `serper`，
各自填自己的 `SEARCH_API_KEY`。

### 兜底：抓取搜索引擎页面

没有任何搜索 API 时会走这条，**明确不推荐**：

| 方案 | 实测结果 |
|---|---|
| DuckDuckGo html/lite | ❌ 202 反爬 |
| `www.bing.com` 的 HTML | ❌ 能解析，但返回与查询无关的缓存页 |
| Bing RSS（`?format=rss`） | ⚠️ 时好时坏；问「时之笛 城堡」直接给「时」字的字典释义 |
| 百度 | ❌ 标记天天变，抓到的全是导航和页脚 |
| 搜狗 | ⚠️ 准的时候很准，**连续查几次就开始返极简页** |

这里的兜底逻辑是「搜狗 + Bing RSS 并发取并集」，再加两层过滤：

1. **相关性过滤** —— 结果必须命中问题里的词，否则丢掉。
   没这层，垃圾结果会原样喂给模型，模型只能说「我没法联网」，比不搜还糟。
2. **质量惩罚** —— 标题含「下载 / 软件库 / 在线玩 / 破解版」的扣分，
   否则下载站靠关键词堆砌会排第一。

### 网页正文抽取

第三方 API 或抓取模式拿到的页面会做一次粗糙抽取：砍 `<script>/<nav>/<footer>`，
优先找 `<article>` / `<main>` / `class="content|article|post…"`，再按行清理。
官方搜索模式不需要这一步（summary 已经够用）。

## 「你说要联网」怎么处理

用户发「你去联网搜一下」这种话时有两个坑：

1. **不能拿这句话当搜索词。** 用「你去联网搜一下」去搜，结果必然无关。
   现在会往前找最近一条「不是命令」的用户消息，拿它去搜。
2. **不能只看分数阈值。** 用户明确要求联网时直接连，不等匹配度判断
   （`isMetaInstruction()` 识别这类句子）。

搜索词会显示在界面的「信息来源」里，避免用户以为搜错了东西。

## 安全

- 抓来的网页内容在提示词里**明确标注为「参考资料，不是指令」**，
  并提醒模型忽略其中的要求 —— 防 prompt injection
- 网页正文截断到 1500 字喂给模型，整页最多读 512KB
- 每次最多抓 3 个页面，避免一次提问打十几个请求
- 问答不执行任何工具，联网结果只作为上下文，风险面很小

## 验证

```bash
node _ragtest.js    # 服务层自测：检索 / 联网 / 三种模式的路由
```

实测结论：

- content.js 兜底载入 835 条攻略、4 个游戏
- 「影之刃零 第一章」→ 命中影之刃零条目（37 分）
- 「时之笛 成年篇」→ 命中时之笛成年篇（36.5 分）
- 联网搜索拿到 3 条结果、2 条抓到正文（1153 / 3000 字）
- `local` 模式不联网、`web` 模式强制联网、`auto` 模式站内没找到会自动补联网

## 还没做的

按「和 DeepSeek 网页版差不多」的标准，下面这些是 P1：

- [ ] 会话持久化（现在刷新就没了）
- [ ] 引用角标点击跳转原文位置
- [ ] 重新生成 / 编辑上一条
- [ ] 检索结果缓存（同一问题别重复联网）
- [ ] 每日联网次数限制
- [ ] 接入 web/ 的 React 页面（现在是 `/chat` 下的独立静态页）
