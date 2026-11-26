# 交接单 · hello-stack 攻略站

> 新会话直接读这个文件就能接上。最后更新：2026-11-26

## 项目

- 本地：`D:\study\hello-stack`
- 线上：http://120.25.123.48:8080
- 技术栈：NestJS + React + MySQL + Nginx + Docker Compose
- 部署：`.\deploy.ps1`（手动）；GitHub Actions 已配好但 CD 还没真正跑通

## 线上现状（以 /api/games 为准）

- 6 个游戏，约 901 条
- 影之刃零 687 / 时之笛 59 / 万缕千丝 46 / 法尔登法环 43 / 流放之路2 29 / 暗黑4 37
- 进度数据 30 条（全在影之刃零），不要清库

## Git

- 分支 `main`，最新提交 `c46e72e`（CI 跳过时列缺失 Secrets）
- 远程：https://github.com/asd942994337/sse_test
- 本机 git 身份按目录自动切：`D:\study` 个人 QQ，`E:\project` 公司邮箱

## 待办（最重要）

### 1. GitHub Actions CD 还差两条 Secret

现在只有 `DEPLOY_SSH_KEY`，还缺：

| Name | Value |
|---|---|
| `DEPLOY_HOST` | `120.25.123.48` |
| `DEPLOY_USER` | `root` |

加完去 https://github.com/asd942994337/sse_test/actions/workflows/deploy.yml 点 Run workflow。
日志出现 `deploy ok, health 200` 即成功；出现 `Permission denied (publickey)` 说明私钥和服务器公钥不匹配，需要重生成。

### 2. 可选

- README 里 CD 状态还没标「已启用」
- `content-fe-chars.js` 348KB，后续可拆接口

## 最近做了什么

- 攻略页分区翻页（每区 20 条 + 显示更多 + 展开全部）
- 内容体检脚本 `npm run check`
- GitHub Actions：`ci.yml`（构建 + 内容体检）、`deploy.yml`（打包 → scp → ssh → 重建 → 健康检查 → 回滚）
- 暗黑4 德鲁伊：3.3.0 改动、开荒两条路线、BD 构成（粉碎/大地/自走浩劫/雷暴/同伴）
- 暗黑4 S16 职业前瞻、低按键推荐

## 验证方式

```powershell
# 线上
curl http://120.25.123.48:8080/api/health
# 本地内容
cd D:\study\hello-stack; npm run check
# 改动后
.\deploy.ps1
```

## 注意

- PowerShell 里 `git push` 显示 `[exit code: 1]` 是假报错，看最后一行 `xxx -> main` 即可
- GitHub 匿名 API 会 403 限流，查 Actions 直接开网页
- 部署前确认没有 `.season/.d4news` 之类的临时目录
