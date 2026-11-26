# 交接单 · hello-stack 攻略站

> 新会话直接读这个文件就能接上。最后更新：2026-11-26

## 项目

- 本地：`D:\study\hello-stack`
- 线上：http://120.25.123.48:8080
- 技术栈：NestJS + React + MySQL + Nginx + Docker Compose
- 部署：`.\deploy.ps1`（手动），或 push 到 main 走 GitHub Actions CD
- 机器：2 vCPU / 1.7G 内存，`docker compose` 三容器（web/api/db）

## 线上现状（2026-11-26 复核，压测后）

- `/api/health`、`/api/ready`、首页 → 200
- 库里：6 个游戏 / 901 条攻略 / 30 条进度 / 2 个用户 / 3 条 session（与本地 `npm run check` 一致）
- ⚠️ `/api/games` 走 `AuthGuard`，匿名 curl 是 **401**，别误判成站点挂了
- 查库：`ssh ecs "docker exec hello-db mysql -uhello -phellopass -e 'select count(*) from hello.guides'"`

## Git

- 分支 `main`，远程 https://github.com/asd942994337/sse_test
- 本机 git 身份按目录自动切：`D:\study` 个人 QQ，`E:\project` 公司邮箱

## CD：已跑通

- 只需要一个 Secret：`DEPLOY_SSH_KEY`。`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT`
  在 `deploy.yml` 里用默认值兜底（`120.25.123.48` / `root` / `22`），配了同名 Secret 才覆盖
- 耗时：CI ≈1 分钟（`npm ci` + `tsc` + `npm run check` + `vite build`），Deploy 再 ≈30~80 秒
  （服务器上 `docker build`，缓存命中就快）→ **别在 30 秒内就判定失败**
- 验证不用翻 Actions 日志：

  ```powershell
  ssh ecs "cat /opt/hello-stack/.deploy"
  # {"at":"2026-11-26T11:39:07+08:00","source":"github-actions","archive":"hello-stack.tgz","phase":"ok"}
  ```

  - `source`：`github-actions` = CD，`manual` = `.\deploy.ps1` 或手动跑 `scripts/deploy-remote.sh`
  - 解包后先写 `.deploy.started`（`phase=started`），健康检查过了才写 `.deploy`（`phase=ok`）；
    只有 `.deploy.started` 说明那次中途挂了——构建失败和就绪超时都会自动回滚到上一版
- 服务器 `~/.ssh/authorized_keys` 两把 ed25519：本机 `~/.ssh/ecs_shenzhen`（手动部署）+
  CI 那把（GitHub runner，Azure IP）

## 压测 / 性能（2026-11-26）

### 那次压测其实没打到登录

朋友用 **Apifox** 压的，请求是 `GET /api/auth/login`，而登录是 **POST** 路由：

- 7,283 次 `GET /api/auth/login` 全部 **404**，峰值 **5,055 req/s**（11:02~11:03）
- 数据库完全没被压到：`Max_used_connections=3`、`Aborted_connects=0`、`Slow_queries=0`
- 只有 9 个 502，是我当时自己的部署在重启 api（11:01），跟压测无关

正确的压法（Apifox / JMeter 都一样）：

```bash
curl -X POST http://120.25.123.48:8080/api/auth/login \
  -H "Content-Type: application/json" \
  --data-binary '{"username":"admin","password":"***"}'
# 200/201 + Set-Cookie: sid=...
```

并发复现脚本：`node scripts/probe-login.mjs 100`（配合 `PROBE_USER` / `PROBE_PASS`，
测完记得删测试账号）。

### 真正的瓶颈（已修）：登录是同步 scrypt

`verifyPassword` 原来用 `scryptSync`，一次 ~52ms，占住 Node 唯一主线程 → 并发登录时**整站冻结**。

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 30 并发登录（错误密码） | 登录 p50 1033ms；**/api/health p50 1691ms，2 秒只探到 2 次** | — |
| 30 并发登录（正确密码） | — | 登录 p50 1179ms；/api/health p50 **24ms**，14 次探测全 200 |
| 100 并发登录（正确密码） | — | 100 个 201，5.5s 完成（p50 2.96s / p90 5.11s）；/api/health p50 **17ms** / p95 97ms，36 次探测全 200 |
| 100 并发登录（错误密码） | 每次都要烧 52ms CPU | **0.48s** 结束：11 个 401 + 89 个 429 |

100 并发登录仍是 5 秒级：scrypt 是**故意**设计成慢的（52ms × 100 次 ÷ 2 核），
想更快只能降代价参数（会削弱抗暴力破解）或加 CPU。现在至少不会把整站拖死。

### 登录失败节流

`src/auth/login-throttle.ts`：按「客户端 IP + 用户名」记失败次数，**5 分钟内失败 10 次 → 429 +
`Retry-After: 300`**，成功一次立刻清零。只数失败，所以正常登录不受影响。
内存 Map，单实例够用；**上多实例要换 Redis 或 Nginx `limit_req`**。

## 最近做了什么

- **压测复盘 + 登录性能修复**：异步 scrypt、失败节流、`aesKey()` 加缓存（原来每个请求都
  `scryptSync` 一次）、Nginx 访问日志加 `rt=` / `urt=`
- **部署脚本两个坑修掉**：
  1. 以前用 `ssh "bash -s ..." < script` 喂脚本，`docker compose` 构建时读 stdin
     （日志里的 `#1 reading from stdin ...`）会把还没执行的脚本行抢走，bash 读到 EOF 静默退出
     → 部署其实成功了，但没有 `.deploy` 指纹、也没跑健康检查。现在改成 **scp 脚本再执行**
  2. Nginx 配置是 bind mount 的**文件**，而部署是换目录：容器的 mount 还指着旧 inode，
     `nginx -s reload` 读到的仍是旧配置（改晚等于没改）。现在按 md5 判断：变了就重建 web
     （状态存 `/opt/hello-stack.state/nginx-conf.md5`），`deploy.ps1` 则直接 force-recreate web
- 之前：CD 跑通（只需 DEPLOY_SSH_KEY）、部署指纹、构建失败回滚、攻略页分区翻页、内容体检

## 验证方式

```powershell
# 线上
curl http://120.25.123.48:8080/api/health
# 最后一版是谁部署的
ssh ecs "cat /opt/hello-stack/.deploy"
# 本地内容体检
cd D:\study\hello-stack; npm run check
# 登录并发（需要测试账号）
$env:PROBE_USER='_probe'; $env:PROBE_PASS='***'; node scripts/probe-login.mjs 100
# 看后端耗时（压测时最有用）
ssh ecs "docker logs --since 10m hello-web 2>&1 | grep 'POST /api/auth/login' | tail -5"
# 手动部署 / 回滚
.\deploy.ps1
.\deploy.ps1 -Rollback
```

## 坑（都踩过了）

- **`deploy.ps1` 是 UTF-8 BOM 文件**。用会丢 BOM 的编辑器/工具改它，PowerShell 5.1 会按 GBK 解析，
  直接报「函数参数列表中缺少 )」。改完先做一次解析检查：
  `[System.Management.Automation.Language.Parser]::ParseFile('deploy.ps1',[ref]$null,[ref]$e)`
  （这次改了 2 次，每次都要补回 BOM）
- **别用 `bash -s` 从 stdin 喂部署脚本**，见上面「部署脚本两个坑」
- `.deploy` 的内容不要用 `ssh "printf ..."` 拼：JSON 的双引号会被 PowerShell / shell 吃掉，
  用 `scp` 传文件
- 本机 `api.github.com` 被代理劫持到 `198.18.0.160`，匿名 API 一直 `403`
  （`X-RateLimit-Remaining: 0`），查 Actions 只能开网页；`web_fetch` 也会以「非公网 IP」拒绝
- PowerShell 里 `git push` 显示 `[exit code: 1]` 是假报错，看最后一行 `xxx -> main` 即可
- `.rag-config.json` 里有真实 DeepSeek key，已被 `.gitignore` 和打包脚本排除，别提交、别打进 tgz
- 部署前确认没有 `.season/.d4news` 之类的临时目录；压测/调试用完的测试账号记得删
