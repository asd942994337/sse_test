<#
.SYNOPSIS
    hello-stack 一键部署：打包 → 上传 → 换目录 → 重建容器 → 健康检查

.DESCRIPTION
    每一步都会打印它在干什么，方便出问题时定位。
    服务器上保留最近一次的可回滚目录（/opt/hello-stack.prev）。

.EXAMPLE
    .\deploy.ps1
        正常部署当前代码

.EXAMPLE
    .\deploy.ps1 -Rollback
        回滚到上一次部署的版本

.EXAMPLE
    .\deploy.ps1 -Logs
        部署完成后跟踪查看 api 日志

.NOTES
    依赖：本机 ssh 别名 ecs 已配置好免密登录；
         服务器已装 docker + docker compose plugin。
#>
[CmdletBinding()]
param(
    [switch]$Rollback,   # 回滚到上一版
    [switch]$NoBuild,    # 不重建镜像（只重启容器）
    [switch]$Logs        # 部署后跟踪日志
)

$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------
$SshTarget   = 'ecs'
$RemoteRoot  = '/opt'
$PublicHost  = '120.25.123.48'
$PublicPort  = 8080

$ProjectDir  = $PSScriptRoot
$ProjectName = Split-Path $ProjectDir -Leaf
$RemoteApp   = "$RemoteRoot/$ProjectName"
$RemoteAppPrev = "$RemoteRoot/$ProjectName.prev"
$RemoteStaging = "$RemoteRoot/$ProjectName.next"
$Stamp       = Get-Date -Format 'yyyyMMdd-HHmmss'
$LocalTgz    = Join-Path $env:TEMP "$ProjectName-$Stamp.tgz"
$RemoteTgz   = "$RemoteRoot/$ProjectName-$Stamp.tgz"

# ---------- 小工具 ----------
function Write-Step($n, $text) {
    Write-Host ""
    Write-Host "[$n] $text" -ForegroundColor Cyan
}

function Invoke-Remote($cmd) {
    # ssh/docker 会把进度写到 stderr，而 $ErrorActionPreference='Stop'
    # 会把 stderr 当成致命错误。这里临时降级，只按退出码判断成败。
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = @()
        & ssh -o BatchMode=yes -o ConnectTimeout=10 $SshTarget $cmd 2>&1 |
            ForEach-Object { $lines += "$_" }
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
    }

    if ($code -ne 0) {
        $lines | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        throw "远程命令失败 (exit $code)：$cmd"
    }
    return ($lines -join "`n")
}

function Test-Health {
    # 就绪探针要轮询：db 初始化、api 连库都需要时间，
    # 只看一次必然误判（这也是容器编排里 readinessProbe 存在的原因）
    for ($i = 1; $i -le 30; $i++) {
        $code = (ssh -o BatchMode=yes $SshTarget "curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:$PublicPort/api/ready").Trim()
        if ($code -eq '200') {
            Write-Host "    第 $i 次探测通过（间隔 2 秒）" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "    60 秒内仍未就绪（最后一次 HTTP $code）" -ForegroundColor Red
    return $false
}

Write-Host "==============================================" -ForegroundColor DarkGray
Write-Host " 部署 $ProjectName  ->  ${SshTarget}:$RemoteApp" -ForegroundColor White
Write-Host "==============================================" -ForegroundColor DarkGray

# ---------- 0. 连通性 ----------
Write-Step 0 "检查 SSH 连接"
$who = Invoke-Remote "hostname"
Write-Host "    已连接：$who" -ForegroundColor Green

# ---------- 回滚分支 ----------
if ($Rollback) {
    Write-Step 1 "回滚到上一版"
    Invoke-Remote "test -d $RemoteAppPrev" | Out-Null
    Invoke-Remote "rm -rf $RemoteRoot/$ProjectName.rollback; mv $RemoteApp $RemoteRoot/$ProjectName.rollback; mv $RemoteAppPrev $RemoteApp; mv $RemoteRoot/$ProjectName.rollback $RemoteAppPrev"
    Write-Host "    已交换目录" -ForegroundColor Green

    Write-Step 2 "重建容器"
    Invoke-Remote "cd $RemoteApp && docker compose up -d --build --force-recreate" | Out-Null
    Write-Host "    完成" -ForegroundColor Green

    if (Test-Health) {
        Write-Host ""
        Write-Host " 回滚成功：http://$PublicHost`:$PublicPort" -ForegroundColor Green
    }
    exit 0
}

# ---------- 1. 打包 ----------
Write-Step 1 "本地打包（排除 node_modules / 日志 / .git）"
if (Test-Path $LocalTgz) { Remove-Item $LocalTgz -Force }

$parent = Split-Path $ProjectDir -Parent
Push-Location $parent
try {
    tar -czf $LocalTgz `
        '--exclude=node_modules' `
        '--exclude=*/node_modules' `
        '--exclude=*/dist' `
        '--exclude=*.log' `
        '--exclude=.git' `
        '--exclude=deploy.ps1' `
        '--exclude=server.err.log' `
        '--exclude=.env' `
        '--exclude=.rag-config.json' `
        $ProjectName
    if ($LASTEXITCODE -ne 0) { throw "打包失败" }
}
finally { Pop-Location }

$sizeKB = [math]::Round((Get-Item $LocalTgz).Length / 1KB, 1)
Write-Host "    $LocalTgz  ($sizeKB KB)" -ForegroundColor Green

# ---------- 2. 上传 ----------
Write-Step 2 "上传到服务器 $RemoteTgz"
$sw = [Diagnostics.Stopwatch]::StartNew()
scp -q $LocalTgz "$SshTarget`:$RemoteTgz"
if ($LASTEXITCODE -ne 0) { throw "上传失败" }
$sw.Stop()
Write-Host "    耗时 $([math]::Round($sw.Elapsed.TotalSeconds,1)) 秒" -ForegroundColor Green

# ---------- 3. 解压到临时目录 ----------
Write-Step 3 "解压到临时目录（不直接覆盖运行中的目录）"
Invoke-Remote "rm -rf $RemoteStaging; mkdir -p $RemoteStaging; tar -xzf $RemoteTgz -C $RemoteStaging" | Out-Null
Write-Host "    完成" -ForegroundColor Green

# ---------- 4. 换目录（旧的留成 .prev 以便回滚） ----------
Write-Step 4 "切换版本目录"
Invoke-Remote "rm -rf $RemoteAppPrev; if [ -d $RemoteApp ]; then mv $RemoteApp $RemoteAppPrev; fi; mv $RemoteStaging/$ProjectName $RemoteApp; rmdir $RemoteStaging 2>/dev/null || true" | Out-Null

# ★ 把上一版的 .env 带过来。
#   否则每次部署换目录，服务器上的 API Key 就跟着旧目录走了，
#   表现是「部署完 AI 突然不会说话了」。
$envKeep = Invoke-Remote "if [ -f $RemoteAppPrev/.env ]; then cp $RemoteAppPrev/.env $RemoteApp/.env && echo kept; else echo none; fi"
if ($envKeep -match 'kept') {
    Write-Host "    已保留上一版的 .env（API Key 不会丢）" -ForegroundColor Green
} else {
    Write-Host "    没有 .env（首次部署需要自己创建）" -ForegroundColor Yellow
}

Write-Host "    当前版本：$RemoteApp" -ForegroundColor Green
Write-Host "    上一版本：$RemoteAppPrev" -ForegroundColor DarkGray

# ---------- 5. 重建并启动 ----------
if ($NoBuild) {
    Write-Step 5 "重启容器（未重建镜像）"
    Invoke-Remote "cd $RemoteApp && docker compose up -d --force-recreate" | Out-Null
} else {
    Write-Step 5 "重建镜像并启动"
    $buildOut = Invoke-Remote "cd $RemoteApp && docker compose up -d --build"
    ($buildOut -split "`n" | Where-Object { $_ -ne '' } | Select-Object -Last 5) |
        ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

$psOut = Invoke-Remote "cd $RemoteApp && docker compose ps"
$psOut -split "`n" | Where-Object { $_ -ne '' } | ForEach-Object { Write-Host "    $_" }

# Nginx 配置是 bind mount，改了不会自动生效；reload 一次让新配置和 DNS 解析生效
try {
    Invoke-Remote "cd $RemoteApp && docker compose exec -T web nginx -s reload" | Out-Null
    Write-Host "    Nginx 已 reload" -ForegroundColor DarkGray
}
catch {
    Write-Host "    Nginx reload 跳过（web 可能还没起来）" -ForegroundColor Yellow
}

# ---------- 6. 健康检查 ----------
Write-Step 6 "健康检查"
Start-Sleep -Seconds 2
if (-not (Test-Health)) {
    Write-Host ""
    Write-Host " 部署完成但健康检查没过，看日志：" -ForegroundColor Yellow
    Write-Host "   ssh $SshTarget `"cd $RemoteApp && docker compose logs --tail=50`"" -ForegroundColor Yellow
    exit 1
}

# 部署指纹：和 GitHub Actions 那套写法保持一致，
# 这样服务器上 cat /opt/hello-stack/.deploy 就能看出最后一版是 CD 还是手动部署的
try {
    $markerJson = '{"at":"' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') +
                  '","source":"manual","archive":"' + (Split-Path $LocalTgz -Leaf) + '","phase":"ok"}'
    $markerFile = Join-Path $env:TEMP 'hello-stack-deploy.json'
    # 用 scp 传文件，别拼进 ssh 命令：JSON 里的双引号会被 PowerShell / shell 吃掉
    [System.IO.File]::WriteAllText($markerFile, $markerJson + "`n")
    scp -q $markerFile "$SshTarget`:$RemoteApp/.deploy"
    if ($LASTEXITCODE -ne 0) { throw "scp 传指纹失败" }
    Write-Host "    已写部署指纹 .deploy（source=manual）" -ForegroundColor DarkGray
}
catch {
    Write-Host "    写部署指纹失败（不影响部署结果）" -ForegroundColor Yellow
}

# ---------- 7. 清理本地临时包 ----------
Remove-Item $LocalTgz -Force -ErrorAction SilentlyContinue
Invoke-Remote "ls -t $RemoteRoot/*.tgz 2>/dev/null | tail -n +6 | xargs -r rm -f" | Out-Null
Write-Host "    已清理旧包（服务器只保留最近 5 个）" -ForegroundColor DarkGray

Write-Host ""
Write-Host " 部署成功 -> http://$PublicHost`:$PublicPort" -ForegroundColor Green
Write-Host " 回滚命令 -> .\deploy.ps1 -Rollback" -ForegroundColor DarkGray

if ($Logs) {
    Write-Host ""
    Write-Host " 跟踪 api 日志（Ctrl+C 退出）..." -ForegroundColor Cyan
    ssh $SshTarget "cd $RemoteApp && docker compose logs -f api"
}
