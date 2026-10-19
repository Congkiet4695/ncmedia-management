#!/usr/bin/env bash
# ============================================================================
# NCMedia Management — Production deploy
#   pull → build → migrate deploy → up → healthcheck → (rollback nếu lỗi)
# Chạy trên VPS: bash deploy/deploy.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# `export` là BẮT BUỘC: docker-compose.production.yml nội suy `${ENV_FILE}` cho khối
# `env_file:`. Không export thì compose lấy mặc định `.env.production` và một lần chạy
# với ENV_FILE=.env.staging sẽ nội suy từ file này nhưng nạp vào container file kia.
export ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE="docker compose -f docker-compose.production.yml --env-file $ENV_FILE"
DATA_ROOT="${DATA_ROOT:-/opt/ncmedia}"
CERTS_DIR="${NCMEDIA_CERTS:-$DATA_ROOT/certs}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[deploy:err]\033[0m %s\n' "$*" >&2; }

# --- 0. Preconditions ---
[ -f "$ENV_FILE" ] || { err "$ENV_FILE không tồn tại. Copy từ .env.production.example và điền secret."; exit 1; }
command -v docker >/dev/null || { err "docker chưa cài."; exit 1; }

# File .env soạn trên Windows mang ký tự CR ở cuối dòng. Docker nạp NGUYÊN VĂN nên
# secret sẽ thừa "\r" → xác thực DB/Redis/TikTok fail với thông báo rất khó hiểu.
# Chặn ngay từ đây thay vì để lỗi hiện ra sau khi container đã chạy.
# `-U` (đọc nhị phân) là bắt buộc: một số bản grep tự bỏ CR ở chế độ văn bản nên
# kiểm tra thường sẽ không bao giờ khớp.
if grep -qU $'\r' "$ENV_FILE"; then
  err "$ENV_FILE có ký tự xuống dòng kiểu Windows (CRLF). Sửa: sed -i 's/\r$//' $ENV_FILE"
  exit 1
fi

# Biến bắt buộc phải có GIÁ TRỊ. Backend cũng validate bằng Joi lúc khởi động, nhưng
# kiểm ở đây thì hỏng sớm hơn nhiều — trước khi build image và chạy migrate.
REQUIRED_ENV_KEYS=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  REDIS_PASSWORD
  JWT_ACCESS_SECRET JWT_REFRESH_SECRET REFRESH_TOKEN_HMAC_SECRET
  ACCOUNT_ENCRYPTION_KEY
  TIKTOK_APP_KEY TIKTOK_APP_SECRET TIKTOK_SERVICE_ID TIKTOK_ENCRYPTION_KEY
)
missing_keys=()
for key in "${REQUIRED_ENV_KEYS[@]}"; do
  grep -qE "^[[:space:]]*${key}=.+" "$ENV_FILE" || missing_keys+=("$key")
done
if [ ${#missing_keys[@]} -gt 0 ]; then
  err "$ENV_FILE thiếu (hoặc để trống) các biến bắt buộc: ${missing_keys[*]}"
  err "Đối chiếu .env.production.example và apps/backend/src/config/env.validation.ts."
  exit 1
fi

log "Cấu hình: $ENV_FILE ($(grep -cE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE") biến sẽ được nạp vào container)."

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

# Đã chạy `prisma migrate deploy` thành công trong lần deploy này chưa (để rollback nói rõ trạng thái DB).
MIGRATED=0

rollback() {
  err "Deploy thất bại → ROLLBACK về image trước."
  # 🔴 Rollback CHỈ đổi image. Schema KHÔNG bị hoàn tác (hoàn tác tự động có thể xoá dữ liệu): migration của dự án
  # phải ADDITIVE (bảng/cột NULLABLE mới) để image cũ vẫn chạy đúng trên schema mới.
  if [ "$MIGRATED" = 1 ]; then
    err "LƯU Ý: migration của lần deploy này ĐÃ được áp và được GIỮ NGUYÊN. Image cũ chạy trên schema mới —"
    err "kiểm tra: $COMPOSE run --rm --no-deps backend npx prisma migrate status"
  fi
  for img in ncmedia-backend ncmedia-frontend; do
    docker image inspect "$img:rollback" >/dev/null 2>&1 && docker tag "$img:rollback" "$img:latest" >/dev/null 2>&1 || true
  done
  $COMPOSE up -d || true
  reload_nginx || true
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

# Nginx phân giải `frontend` / `backend` trong khối `upstream` ra IP ĐÚNG MỘT LẦN lúc nạp
# cấu hình. `up -d` tạo lại backend + frontend (image mới ⇒ IP mới) nhưng KHÔNG tạo lại nginx
# (cấu hình/image của nó không đổi) ⇒ nginx giữ IP cũ. Khi hai container đổi IP cho nhau,
# `/` bị đẩy sang backend ("Cannot GET /") và `/api/` sang frontend, trong khi mọi healthcheck
# vẫn xanh. Reload (kiểm `nginx -t` trước) buộc phân giải lại, không làm rớt kết nối.
reload_nginx() {
  docker exec ncmedia-nginx nginx -t && docker exec ncmedia-nginx nginx -s reload
}

# Gọi MỘT URL từ BÊN TRONG container nginx (busybox wget) và in một dòng tóm tắt an toàn:
#   status=<mã cuối> type=<content-type cuối> next=<số lần thấy /_next/static/> ok=<số lần thấy "status":"ok"> rc=<mã thoát wget>
# Chỉ in mã/kiểu/đếm — không in header (cookie) hay body.
#
# 🔴 KHÔNG dùng `docker exec … | grep -q` ở host: script chạy `set -o pipefail`; `grep -q` thoát ngay khi khớp,
# busybox wget vẫn in tiếp ("saving to…", tiến trình, "saved") ⇒ docker exec nhận SIGPIPE (141) ⇒ cả pipeline
# coi là THẤT BẠI dù đã khớp. Đó chính là lỗi "/login không trả HTML" làm deploy 2026-10-19 rollback oan
# (frontend vẫn trả 200 text/html). Mọi phân tích làm trong container, host chỉ so chuỗi.
probe_http() {
  docker exec ncmedia-nginx sh -c '
    hdr=$(mktemp) body=$(mktemp)
    wget -S -T 10 -O "$body" "$1" 2>"$hdr"; rc=$?
    # wget tự theo redirect và in header của MỌI chặng ⇒ lấy chặng CUỐI.
    status=$(sed -n "s/^ *HTTP\/[0-9.]* \([0-9][0-9][0-9]\).*/\1/p" "$hdr" | tail -n 1)
    ctype=$(sed -n "s/^ *[Cc]ontent-[Tt]ype: *//p" "$hdr" | tail -n 1 | tr -d "\r")
    next=$(grep -c "/_next/static/" "$body")
    ok=$(grep -c "\"status\":\"ok\"" "$body")
    rm -f "$hdr" "$body"
    echo "status=${status:-none} type=${ctype:-none} next=${next:-0} ok=${ok:-0} rc=$rc"
  ' sh "$1" 2>/dev/null || echo "status=none type=none next=0 ok=0 rc=exec-failed"
}

# Trang frontend sẵn sàng = 200 + text/html + có asset Next.js (chứng minh là Next, không phải trang lỗi của
# nginx/backend). `/login` không kèm cookie KHÔNG bị middleware redirect; nếu có redirect thì wget đã theo tới
# trang cuối, nên một redirect hợp lệ (vd /dashboard → /login) vẫn đạt, còn 404/5xx/không kết nối thì không.
check_frontend() {
  local label="$1" url="$2" res
  res="$(probe_http "$url")"
  case "$res" in
    "status=200 type=text/html"*" next="[1-9]*) log "✓ $label: $res"; return 0 ;;
  esac
  err "$label KHÔNG đạt (cần 200 + text/html + asset /_next/static/): $res"
  return 1
}

# API sẵn sàng = 200 + JSON + `"status":"ok"` của /api/v1/health.
check_backend() {
  local label="$1" url="$2" res
  res="$(probe_http "$url")"
  case "$res" in
    "status=200 type=application/json"*" ok="[1-9]*) log "✓ $label: $res"; return 0 ;;
  esac
  err "$label KHÔNG đạt (cần 200 + application/json + status ok): $res"
  return 1
}

# Healthcheck của nginx chỉ gọi /healthz (trả thẳng từ nginx) ⇒ không phát hiện upstream sai.
# Kiểm HAI chặng, độc lập cho backend và frontend, để lỗi nói rõ hỏng ở đâu:
#   1. nginx → upstream trực tiếp (DNS Docker + network + app đang nghe đúng cổng);
#   2. QUA nginx (khối upstream/location đúng — API về backend, trang về frontend).
verify_routing() {
  local failed=0
  check_backend  "Nginx → backend:3000 trực tiếp"  "http://backend:3000/api/v1/health" || failed=1
  check_frontend "Nginx → frontend:3000 trực tiếp" "http://frontend:3000/login"        || failed=1
  check_backend  "Qua Nginx /api/v1/health"         "http://127.0.0.1/api/v1/health"    || failed=1
  check_frontend "Qua Nginx /login"                 "http://127.0.0.1/login"            || failed=1
  return "$failed"
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
MIGRATED=1

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

log "Reload Nginx (phân giải lại IP frontend/backend) + kiểm tra định tuyến…"
reload_nginx   || rollback
sleep 2
verify_routing || rollback

# --- 8. Đối chiếu biến môi trường đã thực sự vào container ---
# Nạp qua `env_file` là im lặng: sai đường dẫn hay sai định dạng một dòng thì biến chỉ
# đơn giản không tồn tại, và lỗi lộ ra ở tận nơi dùng. So khớp ngay để thấy sớm.
log "Đối chiếu biến môi trường trong ncmedia-backend…"
# `|| true`: đây là bước ĐỐI CHIẾU sau khi healthcheck đã xanh. Nó không được phép làm
# hỏng một lần deploy vốn đã thành công.
container_keys="$(docker exec ncmedia-backend printenv 2>/dev/null | cut -d= -f1 | sort -u || true)"
absent_keys=()
while IFS= read -r key; do
  printf '%s\n' "$container_keys" | grep -qx "$key" || absent_keys+=("$key")
done < <(sed -nE 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$ENV_FILE" | sort -u)

if [ ${#absent_keys[@]} -gt 0 ]; then
  err "CẢNH BÁO: các biến sau có trong $ENV_FILE nhưng KHÔNG có trong container: ${absent_keys[*]}"
  err "Kiểm tra khối env_file trong docker-compose.production.yml."
else
  log "✓ Toàn bộ biến trong $ENV_FILE đều có trong process.env của backend."
fi

# --- 9. Dọn tag rollback ---
for img in ncmedia-backend ncmedia-frontend; do
  docker rmi "$img:rollback" >/dev/null 2>&1 || true
done

log "✅ Deploy thành công."
$COMPOSE ps
