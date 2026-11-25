# hello-stack

一个**能跑起来的最小全栈工程**，用来熟悉"从本地到服务器"的完整链路。
React 前端 + Node API + MySQL + Nginx，全部容器化。

```
hello-stack/
├── content.js               攻略内容入口（games + guides 汇总）
├── content-pbz.js           影之刃零：按章节融合主线 / 支线 / 收集
├── content-oot.js           时之笛：开始之前 / 阶段流程 / 幼年 / 成年 / 支线 / 收集 / 速查
├── content-fe.js            火焰纹章：方尖塔 / 日程 / 战斗 / 成长 / 招募 / 外传 / 流程 / 速查
├── content-fe-chars.js      火纹角色图鉴数据（63 人：梯度、成长率、礼物、支援、背景）
├── content-er.js            艾尔登法环：区域流程 / Boss / 支线 / 收集 / 构筑（含「怕老鼠」Mod 方案）
├── content-poe2.js          流放之路2：1.0 征服者前瞻 / 开荒 / 终局 / 构筑
├── content-d4.js            暗黑4：S16 泰瑞尔的赌注前瞻 / 开荒 / 终局 / 构筑
├── src/                     NestJS API
│   ├── main.ts / app.module.ts
│   ├── auth/                登录 / 会话（sid cookie）
│   ├── db/                  连接池 + 建表 + 种子（改内容不用手动动库）
│   ├── guide/               游戏列表、条目详情、进度勾选、搜索
│   └── health/              存活 / 就绪探针
├── web/                     React 18 + TypeScript + Vite
│   ├── src/pages/           Home / GuidePage / Search / Settings / System
│   └── Dockerfile           多阶段：node 构建 → nginx 运行
├── nginx/default.conf       静态托管 + /api 反代（含 Docker DNS 解析）
├── Dockerfile               API 镜像
├── docker-compose.yml       web + api + db
├── deploy.ps1               一键部署 / 回滚
└── package.json             (API 的依赖)
```

## 架构

```
浏览器 ──:8080──> [web: Nginx] ──/api──> [api: Node] ──3306──> [db: MySQL]
                      │
                  dist 静态产物（烤在镜像里）
```

三个容器，只有 `web` 暴露端口。

## 前端为什么用多阶段构建

```dockerfile
FROM node:20-alpine AS build     # 第一阶段：装依赖 + vite build
...
FROM nginx:1.27-alpine           # 第二阶段：只留 dist
COPY --from=build /app/dist /usr/share/nginx/html
```

**最终镜像里没有 Node、没有源码、没有 node_modules**，只有 nginx + 几个静态文件。

实测镜像大小：

| 镜像 | 大小 |
|---|---|
| hello-stack-web | 73.8 MB（基本就是 nginx 本身） |
| hello-stack-api | 211 MB（node + 依赖） |

如果不用多阶段，前端镜像会变成 400MB+。

## 本地开发（两个进程）

新的结构下，前端和后端是分开跑的：

```powershell
# 终端 1：后端
cd D:\study\hello-stack
$env:PORT='5180'; npm start

# 终端 2：前端（热更新）
cd D:\study\hello-stack\web
npm install
npm run dev
```

打开 http://localhost:5173

Vite 会把 `/api/*` 代理到 `127.0.0.1:5180`（见 `vite.config.ts`），
所以浏览器里看起来是同源——**跨域问题在开发阶段就被代理消掉了**。

## 攻略内容怎么维护

内容不在数据库里手改，而是放在仓库的 `content-*.js` 里，部署时由 `DbService.seed()` 写进 MySQL。

- `content.js`：游戏卡片 + 把各游戏条目拼起来
- 每条 item 有 `key`（稳定 slug）、`section`（分区名）、`title`、`tags`（英文逗号分隔）、`kind`（flow / quest / collect / system）、`body`
- 种子按 `(game_id, key)` upsert：**改文案、改排序都不会丢进度**
- 内容表里已经删掉的条目会在种子时自动清理，不会出现新旧两套混在一起

加一条：

```js
item("oot-xxx", "成年篇", "标题", "主线,迷宫", `正文……`)
```

`kind` 现在在时之笛内容里显式传入；没传时按分区名猜：
`支线* → quest`、`阶段流程 / 幼年篇 / 成年篇 → flow`、`收集* → collect`、其余 `system`。

## 角色图鉴

`/characters` 是火纹的角色图鉴（头像表），数据与立绘都在仓库里：

- `content-fe-chars.js`：63 名角色的 `slug / name / en / tier / cls / weapons / rel / later / img`；
- `web/public/portraits/<slug>.webp`：256×256 立绘，Vite 构建时原样拷进 `dist/`；
- `GET /api/characters`：由 `GuideService.characters()` 直接读上面的 js（不写库，改完部署即生效）。

`rel` 是四条线的关系（`初始加入` / `可挖角` / `招不到`），`later` 标记「第三部加入」。
点头像会打开角色详情（成长率、初始值 / Lv60 期望、全员排名、特技、招募状态），
`/characters?c=<slug>` 可以直接分享某个角色的详情。
立绘与梯度整理自 annasnotebook.net，版权归任天堂 / Intelligent Systems。

## CI / CD

仓库里带了两条 GitHub Actions：

- `.github/workflows/ci.yml`：每次 push / PR 跑 `npm ci`、API 构建、`npm run check`（内容体检）、前端构建；
- `.github/workflows/deploy.yml`：`main` 的 CI 成功后，打包 → scp → ssh 执行 `scripts/deploy-remote.sh`（换目录、`docker compose up -d --build`、就绪检查、失败自动回滚）。

启用自动部署需要加 3 个仓库 Secret（Settings → Secrets and variables → Actions）：

| Secret | 值 |
|---|---|
| `DEPLOY_HOST` | `120.25.123.48` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | 部署私钥全文（`-----BEGIN OPENSSH PRIVATE KEY-----` 开头） |
| `DEPLOY_PORT`（可选） | 默认 22 |

建议专门生成一把部署密钥，不要用个人主密钥：

```powershell
ssh-keygen -t ed25519 -f .\deploy_key -N ""
ssh root@120.25.123.48 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys" < .\deploy_key.pub
# 把 deploy_key 的内容填进 DEPLOY_SSH_KEY，然后删掉本地文件
```

没配 Secret 时 Deploy 工作流会输出警告并跳过，不会报红。

手动部署仍然可用：

```powershell
.\deploy.ps1
```

## 部署

```powershell
cd D:\study\hello-stack
.\deploy.ps1              # 打包 → 上传 → 切换 → 构建 → 就绪检查
.\deploy.ps1 -Rollback    # 回滚上一版
.\deploy.ps1 -Logs        # 部署后看日志
```

服务器上执行的是 `docker compose up -d --build`，**前端在服务器上构建**。
构建阶段用 `registry.npmmirror.com`，国内快很多。

## 一个重要的行为变化

| | 之前的纯静态版 | 现在的 React 版 |
|---|---|---|
| 改 `web/` 里的文件 | 刷新浏览器就生效（bind mount） | **必须重新构建**（产物烤进镜像） |
| 构建发生在哪 | 不需要构建 | 服务器上（docker build） |
| 改 `server.js` | 需要 rebuild | 需要 rebuild |

这就是"构建产物"和"源码"的区别。生产环境几乎都是构建进镜像，因为**镜像不可变**才能保证"跑起来的东西和你测过的东西是同一个"。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/hello` | 服务信息（含数据库状态、客户端 IP） |
| GET | `/api/health` | 存活探针 |
| GET | `/api/ready` | 就绪探针（库不可用返回 503） |
| GET | `/api/notes` | 列表 |
| POST | `/api/notes` | 新增 `{"content":"..."}` |
| PATCH | `/api/notes/:id` | 改 `{"done":true}` |
| DELETE | `/api/notes/:id` | 删除 |

## 数据持久化

数据在命名卷 `hello-stack-mysql-data`：

```bash
docker compose restart            # 重启：数据在
docker compose down && up -d      # 重建容器：数据在
docker compose down -v            # 连卷删除：数据没了
```

备份：

```bash
docker exec hello-db mysqldump -uhello -phellopass hello > /opt/backup.sql
```

## 常见问题

**页面 502**
Nginx 连不上 api。本项目已用 `resolver 127.0.0.11` + 变量 `proxy_pass` 让 Nginx 运行时解析容器 IP。
改回静态写法会重新踩坑。

**便签显示"数据库不可用"**
`docker compose ps` 看 db 是否 healthy，`docker compose logs db` 看错误。

**命令行发中文变 `????`**
PowerShell 5.1 的 `Invoke-RestMethod` 默认按 ASCII 发送 body。用 `curl.exe` 并加
`-H "Content-Type: application/json; charset=utf-8"`，或者把 JSON 写进文件用 `--data-binary @file`。
浏览器 `fetch` 默认 UTF-8，不受影响。

**前端构建在服务器上太慢**
2 核机器 `npm ci` + `vite build` 约 1~2 分钟。想更快：本地 `npm run build` 后只传 `dist`，
或者上 CI 在构建机上出镜像。

## 可以接着加的东西

1. 分页、搜索
2. 登录（bcrypt + JWT）
3. React Router（多页面 + Nginx `try_files`）
4. 状态管理（Zustand / TanStack Query，替掉手写 fetch）
5. `.env` + `env_file`，把数据库密码从 compose 里挪出去
6. HTTPS（certbot / 自签证书）
7. CI/CD：push 即部署
