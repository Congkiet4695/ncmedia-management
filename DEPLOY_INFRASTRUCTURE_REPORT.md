# DEPLOY INFRASTRUCTURE REPORT — NCMedia Management

> Chuẩn hoá hạ tầng deploy **Production** (Docker) cho **Ubuntu 24.04 LTS / Hostinger VPS**.
> Toàn bộ config production nằm trong `deploy/`. **Không** đổi business logic / API / Frontend UI.
> **Không** ảnh hưởng Local Dev (`docker-compose.yml` gốc giữ nguyên — xác nhận `git diff` = trống).

---

## 1. Kiến trúc

```
Internet → Cloudflare DNS → Nginx (80/443) ─┬→ Frontend (Next standalone :3000)
                                            └→ /api/  → Backend (Nest :3000, prefix /api/v1)
                                            └→ /uploads/ → bind mount (phục vụ trực tiếp, RO)
Backend → PostgreSQL 16 (:5432 nội bộ) + Redis 7 (:6379 nội bộ)
```
Tất cả chạy Docker. Không cài Postgres/Redis/Node trực tiếp trên host. Chỉ Nginx publish 80/443.

---

## 2. Các file TẠO MỚI

| File | Vai trò |
|---|---|
| `apps/frontend/Dockerfile` | Multi-stage Next.js **standalone**, node22-alpine, non-root, HEALTHCHECK |
| `apps/frontend/.dockerignore` | Loại node_modules/.next/env… khỏi build context |
| `deploy/docker-compose.production.yml` | Stack: postgres, redis, backend, frontend, nginx (+ `seed` profile tools) |
| `deploy/.env.production.example` | Mẫu env (Postgres/Redis/JWT/ACCOUNT_ENCRYPTION_KEY/NEXT_PUBLIC_API_URL/UPLOAD_PATH…) |
| `deploy/nginx.conf` | Reverse proxy FE/BE, WebSocket, Gzip, HTTP/2, security header, 50MB, cache static, no redirect loop |
| `deploy/deploy.sh` | pull→build→`migrate deploy`→up→healthcheck→**rollback** nếu lỗi |
| `deploy/backup.sh` | Backup Postgres (pg_dump) + Uploads (tar) → `/opt/ncmedia/backups` + retention |
| `README_DEPLOY.md` | Hướng dẫn: chuẩn bị VPS, clone, build, deploy, rollback, backup, update, restore |
| `DEPLOY_INFRASTRUCTURE_REPORT.md` | Báo cáo này |

## 3. Các file CHỈNH SỬA (chỉ hạ tầng)

| File | Thay đổi | Ảnh hưởng |
|---|---|---|
| `apps/backend/Dockerfile` | Refactor: thêm `HEALTHCHECK /api/v1/health`, nhúng **Prisma CLI** (khớp version) cho `migrate deploy`, `VOLUME /app/uploads`, build-deps ảo (gỡ sau) | Không đổi runtime app |
| `apps/backend/.dockerignore` | Mở rộng ignore (env/spec/md/…) | Build sạch hơn |
| `apps/frontend/next.config.ts` | Thêm `output: 'standalone'` | **Chỉ** ảnh hưởng `next build` (Docker). `next dev` bỏ qua → Local Dev an toàn |

> `docker-compose.yml` (local) **KHÔNG đổi** (`git diff` trống) — vẫn dùng cho dev.
> **Không** đổi code business/API/UI.

---

## 4. Docker Image

| Image | Base | Kỹ thuật giảm size | Non-root | Healthcheck |
|---|---|---|---|---|
| `ncmedia-backend:latest` | node:22-alpine | multi-stage · `npm prune --omit=dev` · build-deps ảo gỡ sau · chỉ copy `dist/ prisma/ node_modules/ package.json` | `USER node` | `GET /api/v1/health` (node http) |
| `ncmedia-frontend:latest` | node:22-alpine | Next **standalone** (chỉ `server.js` + node_modules tối thiểu) | `USER node` | `GET /` < 500 (node http) |

**Ước tính size** (đo thực khi build trên VPS — xem Mục 8): backend ~**450–550MB** (Nest + Prisma engine + bcrypt + Prisma CLI), frontend ~**180–250MB** (standalone). Base image `node:22-alpine` ~150MB.

**Prisma:** image KHÔNG chạy `migrate`. `prisma generate` trong build; `prisma migrate deploy` chạy ở `deploy.sh` (Prisma CLI đã nhúng trong image → chạy offline, không fetch npm). **Không** dùng `migrate dev`.

---

## 5. Docker Network

- 1 network **`ncmedia`** (driver `bridge`). Mọi service join network này.
- Chỉ `nginx` publish `80:80`, `443:443`. Postgres/Redis/Backend/Frontend **không** publish port → không lộ ra Internet (xác nhận qua `docker compose config`: chỉ nginx có `published`).

---

## 6. Docker Volume — **Bind Mount toàn bộ (KHÔNG named volume)**

| Host (mặc định) | Container | Service | Mode |
|---|---|---|---|
| `/opt/ncmedia/data/postgres` | `/var/lib/postgresql/data` | postgres | rw |
| `/opt/ncmedia/data/redis` | `/data` | redis | rw |
| `/opt/ncmedia/uploads` | `/app/uploads` | backend | rw |
| `/opt/ncmedia/uploads` | `/var/www/uploads` | nginx | ro |
| `/opt/ncmedia/logs` | `/app/logs` | backend | rw |
| `/opt/ncmedia/logs/nginx` | `/var/log/nginx` | nginx | rw |
| `/opt/ncmedia/certs` | `/etc/nginx/certs` | nginx | ro |
| `deploy/nginx.conf` | `/etc/nginx/conf.d/default.conf` | nginx | ro |

Host path override được qua biến `NCMEDIA_*` (mặc định = `/opt/ncmedia/...`). **Uploads** (Avatar/Order/Excel/QR/Product) lưu ngoài container tại `/opt/ncmedia/uploads`.

---

## 7. Healthcheck

| Service | Test | Nguồn |
|---|---|---|
| postgres | `pg_isready -U $USER -d $DB` | compose |
| redis | `redis-cli -a $REDIS_PASSWORD ping | grep PONG` | compose |
| backend | `GET /api/v1/health === 200` | Dockerfile HEALTHCHECK |
| frontend | `GET / < 500` (server sống) | Dockerfile HEALTHCHECK |
| nginx | `wget /healthz` | compose |

`depends_on` dùng `condition: service_healthy` (5 quan hệ): backend→(postgres,redis); frontend→backend; nginx→(frontend,backend). Thứ tự khởi động an toàn.

---

## 8. Runtime Verification

**✅ Đã chạy & PASS trong môi trường hiện tại:**
- `docker --version` → 29.6.1 · `docker compose version` → v2 (Compose plugin).
- **`docker compose -f deploy/docker-compose.production.yml --env-file <env> config` → VALID ✓** (render thành công, nội suy env đầy đủ). Bằng chứng trích từ output:
  - Services: `postgres, redis, backend, frontend, nginx` (+ `seed` chỉ khi `--profile tools`).
  - **Published ports: chỉ `80` và `443` (nginx)** — các service khác không publish.
  - **Tất cả volume là `type: bind`** tới `/opt/ncmedia/...` (không named volume).
  - `condition: service_healthy` × 5; network `ncmedia` (bridge).
- `git diff docker-compose.yml` → trống (Local Dev không đổi).

**⚠️ KHÔNG chạy được trong máy dev hiện tại (giới hạn môi trường — KHÔNG phải lỗi cấu hình):**
- `docker build` / `docker compose build` / `up` / `docker ps` / `docker logs` / healthcheck runtime **không thực thi được** vì **Docker Engine không khởi động** trên máy Windows này:
  - Máy Windows là **guest ảo hoá lồng nhau** (`HypervisorPresent = True`).
  - WSL2 là bản **inbox cũ** (kernel 5.10.16, không hỗ trợ `wsl --update`) và **không có distro nào** ("no installed distributions").
  - Docker Desktop báo **"Docker Desktop is unable to start"** (WSL2 backend không provision được trên nested-VM).
  - Đã nỗ lực khắc phục: khởi động Docker Desktop, chờ >11 phút, thử `wsl --update`, kiểm tra Hyper-V/log — không thể bật engine mà không thay đổi hệ thống rủi ro (cập nhật WSL Store/provision distro/reboot), nằm ngoài phạm vi task.

**➡️ Build/verify thực thi trên TARGET Ubuntu 24.04** qua `bash deploy/deploy.sh` (đã viết để tự: build → migrate deploy → up → healthcheck → rollback nếu lỗi). Trên Ubuntu 24.04 (Docker 29 + Compose v2) toàn bộ lệnh chạy trực tiếp — không vướng giới hạn nested-VM/WSL của máy dev.

> Cam kết trung thực: KHÔNG bịa kết quả build/size/health. Số liệu size ở Mục 4 là **ước tính** cho tới khi build trên VPS. Cấu hình đã được kiểm chứng tối đa mức có thể mà không cần daemon (`compose config`).

---

## 9. Smoke Test (chạy trên VPS sau `deploy.sh`)

```bash
cd /opt/ncmedia/ncmedia-management
bash deploy/deploy.sh                                   # build + migrate + up + healthcheck
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env.production ps   # tất cả (healthy)

curl -k https://localhost/healthz                       # nginx  → ok
curl -k https://localhost/api/v1/health                 # backend→ {"status":"ok",...}
curl -k -I https://localhost/login                      # frontend→ 200
# seed lần đầu (permission catalog + platform):
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env.production --profile tools run --rm seed
```
Kỳ vọng: 5 container `healthy`; API health 200; frontend 200; đăng ký org/đăng nhập hoạt động sau seed.

---

## 10. Known Issues / Lưu ý

1. **Docker Engine không chạy được trên máy dev Windows** (nested-VM + WSL2 cũ, không distro). Build/up phải thực hiện trên VPS Ubuntu 24.04. Đây là giới hạn môi trường, cấu hình đã `compose config` PASS.
2. **TLS cert:** `deploy.sh` sinh **self-signed** nếu thiếu. Production nên đặt **Cloudflare Origin Certificate** vào `/opt/ncmedia/certs/{fullchain,privkey}.pem` (Cloudflare SSL: Full/Full-strict). Nginx listen 80+443 cùng 1 server block, **không** redirect origin → **không redirect loop** với mọi chế độ Cloudflare (ép HTTPS bằng "Always Use HTTPS").
3. **NEXT_PUBLIC_API_URL** nhúng lúc **build** (mặc định `/api/v1` same-origin). Đổi domain/URL API ⇒ phải **build lại** frontend.
4. **Seed** không tự chạy trong `deploy.sh` (chỉ `migrate deploy`). Chạy 1 lần qua `--profile tools run --rm seed` (image target=build có ts-node). Bắt buộc cho lần cài đầu để RBAC hoạt động.
5. **Uploads:** hạ tầng đã sẵn (bind mount `/opt/ncmedia/uploads` + Nginx `/uploads/` + `UPLOAD_PATH`). Code upload (multer…) **chưa** có trong backend hiện tại — khi module upload được thêm sẽ dùng đúng mount này, không cần đổi hạ tầng.
6. **Quyền thư mục bind mount:** trên Ubuntu, entrypoint postgres/redis tự chown data dir. Nếu gặp lỗi quyền, `sudo chown -R` theo uid container.

---

## 11. Deployment Guide (tóm tắt — chi tiết ở `README_DEPLOY.md`)

```bash
# 1. VPS: cài Docker + tạo thư mục
curl -fsSL https://get.docker.com | sh
sudo mkdir -p /opt/ncmedia/{data/postgres,data/redis,uploads,backups,logs/nginx,certs}

# 2. Clone
cd /opt/ncmedia && git clone <REPO_URL> ncmedia-management && cd ncmedia-management

# 3. Env
cp deploy/.env.production.example deploy/.env.production
#   sinh secret: openssl rand -hex 32 (JWT/HMAC) · openssl rand -base64 32 (ACCOUNT_ENCRYPTION_KEY)
nano deploy/.env.production          # DOMAIN + secret thật; đặt Cloudflare Origin Cert vào /opt/ncmedia/certs

# 4. Deploy + seed lần đầu
bash deploy/deploy.sh
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env.production --profile tools run --rm seed

# 5. Update: git pull && bash deploy/deploy.sh
# 6. Backup: bash deploy/backup.sh   (cron 0 2 * * *)
# 7. Rollback: tự động trong deploy.sh; thủ công: retag :rollback → :latest → up -d
```

---

> **Kết luận:** Hạ tầng Production hoàn chỉnh, tự chứa trong `deploy/`, tối ưu (multi-stage, non-root, standalone, bind mount, chỉ 80/443, healthcheck, migrate deploy, rollback, backup). Cấu hình đã `docker compose config` **PASS**. Local Dev & code nghiệp vụ **không đổi**. Build/run thực thi trên Ubuntu 24.04 qua `deploy/deploy.sh` (máy dev Windows không chạy được Docker Engine do nested-VM/WSL — đã ghi rõ ở Mục 8).
