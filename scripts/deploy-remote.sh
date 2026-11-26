#!/usr/bin/env bash
#
# 在服务器上执行：解包 → 换目录 → 重建容器 → 健康检查 → 失败回滚
#
# 用法（由 GitHub Actions 通过 ssh 调用）：
#   ssh root@host "bash -s /tmp/hello-stack.tgz github-actions" < scripts/deploy-remote.sh
#
# $1 = 归档路径（必填）
# $2 = 来源标记，默认 manual；会写进 $APP/.deploy，方便事后判断「这一版是谁部署的」
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

echo "[deploy] source=$SOURCE archive=$ARCHIVE_NAME"
echo "[deploy] unpack $ARCHIVE"
rm -rf "$NEXT"
mkdir -p "$NEXT"
tar -xzf "$ARCHIVE" -C "$NEXT"
rm -f "$ARCHIVE"

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
docker compose up -d --build

echo "[deploy] wait for readiness"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/api/ready" || true)
  if [ "$code" = "200" ]; then
    # 部署指纹：不翻 Actions 日志也能看出最后一版的时间 / 来源 / 归档名
    printf '{"at":"%s","source":"%s","archive":"%s"}\n' \
      "$(date -Is)" "$SOURCE" "$ARCHIVE_NAME" > "$APP/.deploy"
    echo "[deploy] ok, health 200"
    cat "$APP/.deploy"
    exit 0
  fi
  sleep 2
done

echo "[deploy] health check failed, rolling back" >&2
rm -rf "$FAILED"
mv "$APP" "$FAILED"
if [ -d "$PREV" ]; then
  mv "$PREV" "$APP"
  cd "$APP"
  docker compose up -d --build || true
fi
exit 1
