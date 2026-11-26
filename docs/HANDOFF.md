# 交接单 · hello-stack 攻略站

> 新会话直接读这个文件就能接上。最后更新：2026-11-26

## 项目

- 本地：`D:\study\hello-stack`
- 线上：http://120.25.123.48:8080
- 技术栈：NestJS + React + MySQL + Nginx + Docker Compose
- 部署：`.\deploy.ps1`（手动）；GitHub Actions CD 已改成「只要一个 Secret 就能跑」

## 线上现状（2026-11-26 复核）

- `/api/health` → 200；`/api/ready`、首页 → 200
- 内容 901 条（本地 `npm run check`）：影之刃零 687 / 时之笛 59 / 万缕千丝 46 / 法尔登法环 43 / 流放之路2 29 / 暗黑4 37
- ⚠️ `/api/games` 现在走 `AuthGuard`，匿名 curl 是 **401**，别误判成站点挂了；要看数据先登录拿 sid cookie
- 进度数据 30 条（全在影之刃零），不要清库

## Git

- 分支 `main`，远程 https://github.com/asd942994337/sse_test
- 本机 git 身份按目录自动切：`D:\study` 个人 QQ，`E:\project` 公司邮箱

## CD 现状（重点）

- `deploy.yml` 里 **`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT` 都有默认值**（`120.25.123.48` / `root` / `22`），
  Secrets 里配了同名项才覆盖 → **仓库只需要 `DEPLOY_SSH_KEY` 一个 Secret 就能部署**
- 服务器 `~/.ssh/authorized_keys` 有两把 ed25519：本机 `~/.ssh/ecs_shenzhen`（手动部署用）+ 一把 CI 用的
- CD 的「远端一半」已在本机原样模拟跑通两次：`[deploy] ok, health 200`，`.env` 没丢，镜像没变时不重建容器（零停机）
- **怎么确认 CD 真跑了**（不用翻 Actions 日志）：

  ```powershell
  ssh ecs "cat /opt/hello-stack/.deploy"
  # {"at":"2026-11-26T10:51:23+08:00","source":"local-sim","archive":"hello-stack.tgz"}
  ```

  `at` 比最后一次 push 新、`source` 是 `github-actions` → CI + CD 都通了。
  `source` 是 `local-sim` 是本机模拟的，`manual` 是手动调用 `scripts/deploy-remote.sh`。

## 待办

1. push 之后看 `.deploy` 时间戳有没有变新
   - 没变 + Actions 里 Deploy 是 skipped → `DEPLOY_SSH_KEY` 没配
   - 没变 + 日志 `Permission denied (publickey)` → 私钥和服务器公钥不匹配，重生成
   - 没变 + CI 红了 → 先看 ci.yml 那三步
2. `content-fe-chars.js` 348KB，后续可拆接口（可选，一直没做）

## 最近做了什么

- CD 改造：`deploy.yml` 的 HOST/USER/PORT 用默认值兜底，只剩 `DEPLOY_SSH_KEY` 一个必需 Secret；
  打包多排除 `.rag-config.json`（本机真 key 别上传）；Summary 里写清目标主机和 commit
- `scripts/deploy-remote.sh` 支持第二个参数标记来源，成功后写 `/opt/hello-stack/.deploy` 指纹
- 本机模拟 CD 远端流程跑通：打包 → scp → ssh → 换目录 → 就绪检查（`deploy ok, health 200`）
- 攻略页分区翻页（每区 20 条 + 显示更多 + 展开全部）
- 内容体检脚本 `npm run check`
- 暗黑4 德鲁伊：3.3.0 改动、开荒两条路线、BD 构成；S16 职业前瞻

## 验证方式

```powershell
# 线上
curl http://120.25.123.48:8080/api/health
# CD 指纹
ssh ecs "cat /opt/hello-stack/.deploy"
# 本地内容体检
cd D:\study\hello-stack; npm run check
# 手动部署 / 回滚
.\deploy.ps1
.\deploy.ps1 -Rollback
```

## 注意

- 本机 `api.github.com` 被代理劫持到 `198.18.0.160`，匿名 API 一直 `403`（`X-RateLimit-Remaining: 0`），
  查 Actions 只能开网页，别指望 curl；`web_fetch` 也会以「非公网 IP」拒绝
- PowerShell 里 `git push` 显示 `[exit code: 1]` 是假报错，看最后一行 `xxx -> main` 即可
- `.rag-config.json` 里有真实 DeepSeek key，已被 `.gitignore` 和打包脚本排除，别提交、别打进 tgz
- 部署前确认没有 `.season/.d4news` 之类的临时目录
