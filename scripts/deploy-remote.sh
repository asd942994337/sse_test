#!/usr/bin/env bash
#
# 在服务器上执行：解包 → 换目录 → 重建容器 → 健康检查 → 失败回滚
#
# 用法（由 GitHub Actions 通过 ssh 调用）：
#   ssh root@host "bash -s /tmp/hello-stack.tgz github-actions" < scripts/deploy-remote.sh
#
# $1 = 归档路径（必填）
# $2 = 来源标记，默认 manual；写进应用目录的 .deploy 指纹，事后不看日志也能判断这版是谁部署的
#
set -euo pipefail

ARCHIVE="${1:?usage: deploy-remote.sh <archive> [source]}"
SOURCE="${2:-manual}"
ROOT="${REMOTE_ROOT:-/opt}"
NAME="${APP_NAME:-hello-stack}"
PORT="${PUBLIC_PORT:-8080}"

ARCHIVE_NAME="$(basename "$ARCHIVE")"

APP="$ROOT/$NAME"
PREV="$ROOT/$NAME.prev"
NEXT="$ROOT/$NAME.next"
FAILED="$ROOT/$NAME.failed"

# marker <文件> <阶段>：phase=started 是「开始了」，phase=ok 是「健康检查过了」
marker() {
  printf '{"at":"%s","source":"%s","archive":"%s","phase":"%s"}\n' \
    "$(date -Is)" "$SOURCE" "$ARCHIVE_NAME" "$2" > "$1"
}

rollback() {
  echo "[deploy] rolling back to previous version" >&2
  rm -rf "$FAILED"
  mv "$APP" "$FAILED"
  if [ -d "$PREV" ]; then
    mv "$PREV" "$APP"
    cd "$APP"
    docker compose up -d --build || true
  fi
  exit 1
}

echo "[deploy] source=$SOURCE archive=$ARCHIVE_NAME"
echo "[deploy] unpack $ARCHIVE"
rm -rf "$NEXT"
mkdir -p "$NEXT"
tar -xzf "$ARCHIVE" -C "$NEXT"
rm -f "$ARCHIVE"

# 先留一条「开始了」的痕迹：只有 .deploy.started 没有 .deploy，说明这次中途挂了
marker "$NEXT/.deploy.started" started

# 保留正在运行版本的 .env（API Key 等），归档里不含 .env
if [ -f "$APP/.env" ]; then
  cp -f "$APP/.env" "$NEXT/.env"
fi

echo "[deploy] swap $APP -> $PREV"
rm -rf "$PREV"
if [ -d "$APP" ]; then
  mv "$APP" "$PREV"
fi
mv "$NEXT" "$APP"

echo "[deploy] docker compose up -d --build"
cd "$APP"
# 构建失败也要回到上一版：否则新代码已经落地、容器还是旧的，最容易被误判成「部署成功」
docker compose up -d --build </dev/null || rollback

# nginx 配置是 bind mount 的**文件**，而部署是换目录：容器的 mount 还指着旧 inode，
# `nginx -s reload` 读到的仍是旧配置（改了等于没改，而且没有任何报错）。
# 所以这里比 md5：配置变了就重建 web 容器，没变才用 reload。
STATE="$ROOT/$NAME.state"
mkdir -p "$STATE"
CONF_MD5="$(md5sum nginx/default.conf | awk '{print $1}')"
if [ "$(cat "$STATE/nginx-conf.md5" 2>/dev/null || true)" != "$CONF_MD5" ]; then
  echo "[deploy] nginx conf changed -> recreate web"
  docker compose up -d --force-recreate web </dev/null || rollback
  echo "$CONF_MD5" > "$STATE/nginx-conf.md5"
else
  echo "[deploy] nginx conf unchanged -> reload"
  docker compose exec -T web nginx -s reload </dev/null >/dev/null 2>&1 \
    && echo "[deploy] nginx reloaded" \
    || echo "[deploy] nginx reload skipped"
fi

echo "[deploy] wait for readiness"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/api/ready" || true)
  if [ "$code" = "200" ]; then
    marker "$APP/.deploy" ok
    echo "[deploy] ok, health 200"
    cat "$APP/.deploy"
    exit 0
  fi
  sleep 2
done

echo "[deploy] health check failed" >&2
rollback
