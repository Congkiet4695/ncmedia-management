# NCMedia Management — Production Deployment Guide

> Hạ tầng deploy Production bằng Docker cho **Ubuntu 24.04 LTS** (Hostinger VPS).
> Toàn bộ config production nằm trong `deploy/`. **Không ảnh hưởng Local Dev** (`docker-compose.yml` gốc vẫn dùng cho local).

```
Internet → Cloudflare DNS → Nginx (80/443) → Frontend (Next) → Backend (Nest) → PostgreSQL / Redis
                                            └→ /uploads (bind mount, phục vụ trực tiếp)
```

Mọi thứ chạy trong Docker: **không** cài PostgreSQL / Redis / Node trực tiếp trên host.

---

## 1. Chuẩn bị VPS

```bash
# Docker + Compose v2 (nếu chưa có)
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version

# Thư mục dữ liệu (bind mount — deploy.sh cũng tự tạo)
sudo mkdir -p /opt/ncmedia/{data/postgres,data/redis,uploads,backups,logs/nginx,certs}
```

Cloudflare: trỏ DNS `A` record về IP VPS. SSL mode khuyến nghị **Full (strict)** + bật **Always Use HTTPS**.

---

## 2. Clone Source

```bash
sudo mkdir -p /opt/ncmedia && cd /opt/ncmedia
git clone <REPO_URL> ncmedia-management
cd ncmedia-management
```

> Vị trí source cố định: `/opt/ncmedia/ncmedia-management`.

---

## 3. Cấu hình biến môi trường

```bash
cd deploy
cp .env.production.example .env.production

# Sinh secret:
openssl rand -hex 32      # JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / REFRESH_TOKEN_HMAC_SECRET
openssl rand -base64 32   # ACCOUNT_ENCRYPTION_KEY (đúng 32 byte)
openssl rand -base64 24   # POSTGRES_PASSWORD / REDIS_PASSWORD

nano .env.production       # điền DOMAIN + secret THẬT
```

**TLS cert:** đặt Cloudflare Origin Certificate vào `/opt/ncmedia/certs/` với tên `fullchain.pem` + `privkey.pem`.
Nếu bỏ trống, `deploy.sh` sinh **self-signed** tạm (dùng được với Cloudflare Full, không phải Full-strict).

---

## 4. Build & Deploy

```bash
cd /opt/ncmedia/ncmedia-management
bash deploy/deploy.sh
```

`deploy.sh` tự động: tạo thư mục + cert → snapshot rollback → build → khởi động Postgres/Redis →
`prisma migrate deploy` → up toàn stack → healthcheck (rollback nếu lỗi).

**Seed lần đầu** (permission catalog + platform — bắt buộc để RBAC hoạt động):

```bash
cd deploy
docker compose -f docker-compose.production.yml --env-file .env.production --profile tools run --rm seed
```

Kiểm tra:

```bash
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env.production ps
curl -k https://localhost/api/v1/health     # {"status":"ok",...}
```

---

## 5. Update (deploy phiên bản mới)

```bash
cd /opt/ncmedia/ncmedia-management
git pull
bash deploy/deploy.sh          # build lại + migrate deploy + healthcheck (+ rollback nếu lỗi)
```

---

## 6. Rollback

- **Tự động:** `deploy.sh` rollback về image `:rollback` khi build/migrate/health lỗi.
- **Thủ công:**

```bash
cd deploy
docker tag ncmedia-backend:rollback ncmedia-backend:latest
docker tag ncmedia-frontend:rollback ncmedia-frontend:latest
docker compose -f docker-compose.production.yml --env-file .env.production up -d
```

> Rollback code: `git checkout <tag/commit cũ>` rồi `bash deploy/deploy.sh`.

---

## 7. Backup

```bash
bash deploy/backup.sh          # pg_dump + tar uploads → /opt/ncmedia/backups (giữ 14 ngày)
```

Cron hằng ngày 02:00:

```bash
crontab -e
0 2 * * * cd /opt/ncmedia/ncmedia-management && bash deploy/backup.sh >> /opt/ncmedia/logs/backup.log 2>&1
```

---

## 8. Restore

**PostgreSQL:**

```bash
cd deploy
gunzip -c /opt/ncmedia/backups/postgres_YYYYmmdd_HHMMSS.sql.gz \
 | docker compose -f docker-compose.production.yml --env-file .env.production exec -T postgres \
     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

**Uploads:**

```bash
tar -xzf /opt/ncmedia/backups/uploads_YYYYmmdd_HHMMSS.tar.gz -C /opt/ncmedia/uploads
```

---

## 9. Vận hành

| Việc | Lệnh (trong `deploy/`) |
|---|---|
| Xem trạng thái | `docker compose -f docker-compose.production.yml --env-file .env.production ps` |
| Log 1 service | `... logs -f backend` |
| Restart 1 service | `... restart backend` |
| Migrate thủ công | `... run --rm --no-deps backend npx prisma migrate deploy` |
| Dừng toàn bộ | `... down` |
| Dừng + xoá dữ liệu | ⚠️ dữ liệu ở bind mount `/opt/ncmedia/data` — `down` KHÔNG xoá; xoá thủ công nếu cần |

---

## 10. Ghi chú kiến trúc

- **Chỉ Nginx** publish `80/443`. Postgres/Redis/Backend/Frontend chỉ trong network nội bộ `ncmedia`.
- **Bind mount toàn bộ** (không named volume): dữ liệu nằm ở `/opt/ncmedia/{data,uploads,backups,logs}` → an toàn khi rebuild container.
- **Uploads** (Avatar/Order/Excel/QR/Product) lưu tại `/opt/ncmedia/uploads`, mount vào backend (`/app/uploads`) và Nginx (RO, phục vụ `/uploads/`). Không lưu trong container.
- **Prisma:** chỉ `migrate deploy` (không `migrate dev`). Migrate chạy ở `deploy.sh`, không trong Dockerfile.
- **NEXT_PUBLIC_API_URL** nhúng lúc build (mặc định `/api/v1` same-origin qua Nginx). Đổi thì phải build lại frontend.
