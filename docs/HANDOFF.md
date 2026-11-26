# 交接单 · hello-stack 攻略站

> 新会话直接读这个文件就能接上。最后更新：2026-11-26

## 项目

- 本地：`D:\study\hello-stack`
- 线上：http://120.25.123.48:8080
- 技术栈：NestJS + React + MySQL + Nginx + Docker Compose
- 部署：`.\deploy.ps1`（手动），或 push 到 main 走 GitHub Actions CD

## 线上现状（2026-11-26 复核）

- `/api/health`、`/api/ready`、首页 → 200
- 库里：6 个游戏 / 901 条攻略 / 30 条进度 / 2 个用户（数字与本地 `npm run check` 一致）
- ⚠️ `/api/games` 走 `AuthGuard`，匿名 curl 是 **401**，别误判成站点挂了
- 查库：`ssh ecs "docker exec hello-db mysql -uhello -phellopass -e 'select count(*) from hello.guides'"`

## Git

- 分支 `main`，远程 https://github.com/asd942994337/sse_test
- 本机 git 身份按目录自动切：`D:\study` 个人 QQ，`E:\project` 公司邮箱

## CD：已跑通（2026-11-26 10:56 第一次真实成功）

- 只需要一个 Secret：`DEPLOY_SSH_KEY`。`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT`
  在 `deploy.yml` 里用默认值兜底（`120.25.123.48` / `root` / `22`），配了同名 Secret 才覆盖
- 耗时：CI ≈1 分钟（`npm ci` + `tsc` + `npm run check` + `vite build`），Deploy 再 ≈80 秒
  （服务器上 `docker build`）→ **别在 30 秒内就判定失败**，这是最后一次踩的坑
- 验证不用翻 Actions 日志：

  ```powershell
  ssh ecs "cat /opt/hello-stack/.deploy"
  # {"at":"2026-11-26T10:56:08+08:00","source":"github-actions","archive":"hello-stack.tgz","phase":"ok"}
  ```

  - `source`：`github-actions` = CD，`manual` = `.\deploy.ps1` 或手动跑 `scripts/deploy-remote.sh`
  - 解包后先写 `.deploy.started`（`phase=started`），健康检查过了才写 `.deploy`（`phase=ok`）；
    只有 `.deploy.started` 说明那次中途失败——构建失败和就绪超时都会自动回滚到上一版
- 服务器 `~/.ssh/authorized_keys` 两把 ed25519：本机 `~/.ssh/ecs_shenzhen`（手动部署）+
  CI 那把（GitHub runner，`40.124.79.128` 之类 Azure IP）

## 待办

1. （可选）`content-fe-chars.js` 348KB 拆接口，一直没做
2. （可选）`deploy.ps1 -NoBuild` 用的是 `up -d --force-recreate`，会把 db 容器也重建
   （数据在命名卷里不会丢，但没必要）——可改成只重建 web/api

## 最近做了什么

- **CD 改造并实跑成功**：`deploy.yml` 的 HOST/USER/PORT 用默认值兜底，只剩 `DEPLOY_SSH_KEY`
  一个必需 Secret；打包多排除 `.rag-config.json`（本机真 key 别上传）
- `scripts/deploy-remote.sh`：支持 `$2` 来源标记、写 `.deploy` / `.deploy.started` 指纹、
  构建失败也回滚（原来只有就绪检查失败才回滚）
- `deploy.ps1`：部署成功后写 `.deploy`（`source=manual`）
- README：CD 只需一个 Secret + 指纹说明
- 之前：攻略页分区翻页、内容体检脚本 `npm run check`、暗黑4 德鲁伊/S16 内容

## 验证方式

```powershell
# 线上
curl http://120.25.123.48:8080/api/health
# 最后一版是谁部署的
ssh ecs "cat /opt/hello-stack/.deploy"
# 本地内容体检
cd D:\study\hello-stack; npm run check
# 手动部署 / 回滚
.\deploy.ps1
.\deploy.ps1 -Rollback
```

## 坑（都踩过了）

- **`deploy.ps1` 是 UTF-8 BOM 文件**。用会丢 BOM 的编辑器/工具改它，PowerShell 5.1 会按 GBK 解析，
  直接报「函数参数列表中缺少 )」。改完先做一次解析检查：
  `[System.Management.Automation.Language.Parser]::ParseFile('deploy.ps1',[ref]$null,[ref]$e)`
- `.deploy` 的内容不要用 `ssh "printf ..."` 拼：JSON 的双引号会被 PowerShell / shell 吃掉，
  用 `scp` 传文件
- 本机 `api.github.com` 被代理劫持到 `198.18.0.160`，匿名 API 一直 `403`（`X-RateLimit-Remaining: 0`），
  查 Actions 只能开网页；`web_fetch` 也会以「非公网 IP」拒绝
- PowerShell 里 `git push` 显示 `[exit code: 1]` 是假报错，看最后一行 `xxx -> main` 即可
- `.rag-config.json` 里有真实 DeepSeek key，已被 `.gitignore` 和打包脚本排除，别提交、别打进 tgz
- 部署前确认没有 `.season/.d4news` 之类的临时目录
