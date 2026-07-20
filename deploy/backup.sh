#!/usr/bin/env bash
# ============================================================================
# NCMedia Management — Backup PostgreSQL + Uploads → /opt/ncmedia/backups
# Chạy thủ công hoặc qua cron:  0 2 * * *  bash /opt/ncmedia/ncmedia-management/deploy/backup.sh
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE="docker compose -f docker-compose.production.yml --env-file $ENV_FILE"
DATA_ROOT="${DATA_ROOT:-/opt/ncmedia}"
BACKUP_DIR="${NCMEDIA_BACKUPS:-$DATA_ROOT/backups}"
UPLOADS_DIR="${NCMEDIA_UPLOADS:-$DATA_ROOT/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TS="$(date +%Y%m%d_%H%M%S)"

[ -f "$ENV_FILE" ] || { echo "[backup:err] $ENV_FILE không tồn tại" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

# Nạp POSTGRES_* từ env
set -a; . "./$ENV_FILE"; set +a

# --- 1. PostgreSQL dump (nén gzip) ---
echo "[backup] pg_dump → postgres_${TS}.sql.gz"
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/postgres_${TS}.sql.gz"

# --- 2. Uploads ---
if [ -d "$UPLOADS_DIR" ] && [ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null || true)" ]; then
  echo "[backup] tar uploads → uploads_${TS}.tar.gz"
  tar -czf "$BACKUP_DIR/uploads_${TS}.tar.gz" -C "$UPLOADS_DIR" .
else
  echo "[backup] uploads rỗng — bỏ qua"
fi

# --- 3. Retention ---
echo "[backup] Xoá backup > ${RETENTION_DAYS} ngày"
find "$BACKUP_DIR" -type f -name 'postgres_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -type f -name 'uploads_*.tar.gz'  -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

echo "[backup] ✅ Xong → $BACKUP_DIR"
ls -lh "$BACKUP_DIR" | tail -n 5
