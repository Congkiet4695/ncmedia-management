#!/usr/bin/env bash
# ============================================================================
# NCMedia Management — Production deploy
#   pull → build → migrate deploy → up → healthcheck → (rollback nếu lỗi)
# Chạy trên VPS: bash deploy/deploy.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE="docker compose -f docker-compose.production.yml --env-file $ENV_FILE"
DATA_ROOT="${DATA_ROOT:-/opt/ncmedia}"
CERTS_DIR="${NCMEDIA_CERTS:-$DATA_ROOT/certs}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[deploy:err]\033[0m %s\n' "$*" >&2; }

# --- 0. Preconditions ---
[ -f "$ENV_FILE" ] || { err "$ENV_FILE không tồn tại. Copy từ .env.production.example và điền secret."; exit 1; }
command -v docker >/dev/null || { err "docker chưa cài."; exit 1; }

# --- 1. Thư mục dữ liệu (bind mount) + TLS cert ---
log "Chuẩn bị thư mục dữ liệu tại $DATA_ROOT …"
mkdir -p "$DATA_ROOT/data/postgres" "$DATA_ROOT/data/redis" \
         "$DATA_ROOT/uploads" "$DATA_ROOT/backups" "$DATA_ROOT/logs/nginx" "$CERTS_DIR"

if [ ! -f "$CERTS_DIR/fullchain.pem" ] || [ ! -f "$CERTS_DIR/privkey.pem" ]; then
  DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | cut -d= -f2- || true)"
  log "Chưa có TLS cert → sinh self-signed cho '${DOMAIN:-localhost}' (production nên thay Cloudflare Origin Cert)."
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$CERTS_DIR/privkey.pem" -out "$CERTS_DIR/fullchain.pem" \
    -subj "/CN=${DOMAIN:-localhost}" >/dev/null 2>&1
fi

# --- 2. Snapshot image hiện tại để rollback ---
for img in ncmedia-backend ncmedia-frontend; do
  if docker image inspect "$img:latest" >/dev/null 2>&1; then
    docker tag "$img:latest" "$img:rollback" >/dev/null 2>&1 || true
  fi
done

rollback() {
  err "Deploy thất bại → ROLLBACK về image trước."
  for img in ncmedia-backend ncmedia-frontend; do
    docker image inspect "$img:rollback" >/dev/null 2>&1 && docker tag "$img:rollback" "$img:latest" >/dev/null 2>&1 || true
  done
  $COMPOSE up -d || true
  err "Đã rollback. Xem log: $COMPOSE logs --tail=100"
  exit 1
}

wait_healthy() {
  local name="$1" tries="${2:-40}" st
  for _ in $(seq 1 "$tries"); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null || echo missing)"
    [ "$st" = healthy ] && return 0
    [ "$st" = missing ] && sleep 2 && continue
    sleep 3
  done
  return 1
}

# --- 3. Pull base images ---
log "Pull base images (postgres/redis/nginx)…"
$COMPOSE pull postgres redis nginx || true

# --- 4. Build backend + frontend + seed (tools) ---
# QUAN TRỌNG: service `seed` dùng image RIÊNG `ncmedia-backend-tools:latest` (target: build),
# KHÁC image runtime của `backend`. Nếu không build lại image tools ở đây, `run --rm seed`
# sẽ tái dùng image cũ (stale) → seed catalog permission cũ (vd thiếu report.*). Phải build cả seed.
log "Build backend + frontend + seed (tools)…"
$COMPOSE build backend frontend || rollback
$COMPOSE --profile tools build seed || rollback

# --- 5. Postgres/Redis lên trước → migrate deploy ---
log "Khởi động Postgres + Redis…"
$COMPOSE up -d postgres redis
wait_healthy ncmedia-postgres || rollback
wait_healthy ncmedia-redis    || rollback

log "prisma migrate deploy…"
$COMPOSE run --rm --no-deps backend npx prisma migrate deploy || rollback

# Seed dữ liệu tham chiếu BẮT BUỘC: permission catalog + platform + backfill role_permissions.
# Idempotent (upsert). Thiếu bước này → catalog trống → /auth/me trả permissions:[]. SEED_DEMO=false (không tạo admin demo).
log "Seed catalog permission/platform + backfill role_permissions…"
# `--build` để LUÔN rebuild image tools ngay trước khi seed (chống chạy seed từ image cũ/stale).
$COMPOSE --profile tools run --build --rm seed || {
  err "Seed thất bại. Catalog permission có thể trống → /auth/me sẽ trả []. Chạy tay: $COMPOSE --profile tools run --build --rm seed"
  rollback
}

# --- 6. Up toàn bộ stack ---
log "Khởi động Backend + Frontend + Nginx…"
$COMPOSE up -d || rollback

# --- 7. Healthcheck ---
log "Chờ healthcheck…"
wait_healthy ncmedia-backend  || rollback
wait_healthy ncmedia-frontend || rollback
wait_healthy ncmedia-nginx    || rollback

# --- 8. Dọn tag rollback ---
for img in ncmedia-backend ncmedia-frontend; do
  docker rmi "$img:rollback" >/dev/null 2>&1 || true
done

log "✅ Deploy thành công."
$COMPOSE ps
