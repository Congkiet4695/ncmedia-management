# PROJECT BOOTSTRAP REVIEW

> Product: **NCMedia Management Platform** — Backend
> Reviewer: Principal Engineer · Ngày: 2026-07-14
> Mục tiêu: Chuẩn hóa project trước khi implement business (Auth Module).
> Phạm vi: **không** sinh Auth/API/NestJS module/Frontend. Chỉ chuẩn hóa cấu hình & hạ tầng.

---

## 1. Thay đổi đã áp dụng

| # | Việc | Kết quả |
|---|---|---|
| 1 | `engines` trong `package.json` | ✅ `node >=22.0.0`, `npm >=10.0.0` |
| 2 | Chuyển secret khỏi `docker-compose.yml` → `.env` (interpolation `${VAR}`) | ✅ POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REFRESH_TOKEN_HMAC_SECRET (+ POSTGRES_USER/DB, REDIS_PASSWORD, PGADMIN_*) |
| 3 | Cập nhật `.env.example` | ✅ Bổ sung POSTGRES_*, PGADMIN_*, các cổng |
| 4 | Thêm **pgAdmin** vào compose | ✅ `dpage/pgadmin4:8.14`, port `${PGADMIN_PORT:-5050}`, depends_on postgres healthy |
| 5 | Fix bcrypt native build trên Alpine (Dockerfile) | ✅ Thêm `python3 make g++` ở stage `deps` |
| 6 | Healthcheck cho service `api` | ✅ Node inline gọi `/api/v1/health` |

---

## 2. Kiểm tra Dependencies

**Tương thích phiên bản (đồng bộ hệ NestJS 11):**
- `@nestjs/common|core|platform-express` `^11` · `@nestjs/config ^4` · `@nestjs/swagger ^11` — tương thích Nest 11. ✅
- `@nestjs/platform-express ^11` đi với `@types/express ^5` (Express 5). ✅
- `prisma` & `@prisma/client` cùng `^6.3.1`. ✅ (bắt buộc khớp major)
- `nestjs-pino ^4.3` ↔ `pino-http ^10.4` (peer đúng). ✅ `pino-pretty` chỉ dev. ✅
- `class-validator ^0.14` + `class-transformer ^0.5` — chuẩn cho ValidationPipe. ✅
- `joi ^17`, `helmet ^8`, `ioredis ^5` — ổn định, không xung đột. ✅

**Điểm đã xử lý:**
- ⚠️→✅ **bcrypt (native) trên Alpine/musl:** `bcrypt ^5` thường phải build từ source trên musl → `npm ci` cần `python3/make/g++`. Đã thêm vào stage `deps` của Dockerfile (không lọt vào image runtime).

**Khuyến nghị (không chặn):**
- 🟡 `bcrypt` đang ở `dependencies` (đúng, vì có thể dùng runtime cho verify password sau này ở Auth). Nếu muốn tránh hẳn native build, có thể cân nhắc `bcryptjs` (thuần JS) — nhưng `bcrypt` hiệu năng tốt hơn; **giữ nguyên**.
- 🟡 Có thể thêm `pino` vào `dependencies` tường minh (hiện lấy transitively qua `pino-http`) để khóa phiên bản chủ động. Tùy chọn.

---

## 3. Kiểm tra package.json

- ✅ `engines` đã có.
- ✅ `prisma.seed` trỏ `ts-node prisma/seed.ts`.
- ✅ Scripts đầy đủ: build/start(:dev,:prod)/lint/format/test/prisma(:generate,:migrate,:deploy,:studio)/db:seed/prepare.
- ✅ `lint-staged` + `husky prepare` cấu hình đúng.
- ✅ `private: true`, không lộ publish.
- ✅ Không có `type: module` → CommonJS nhất quán với build NestJS; `eslint.config.mjs` (ESM) vẫn chạy nhờ đuôi `.mjs`.

**Lưu ý (không chặn):**
- 🟡 **Seed trong image production:** Dockerfile `npm prune --omit=dev` loại `ts-node` → `docker compose exec api npm run db:seed` sẽ KHÔNG chạy được trong image prod. Đây là hành vi đúng cho image gọn. **Khuyến nghị:** chạy `migrate deploy` + `db:seed` từ môi trường dev/CI (nơi còn devDeps), hoặc thêm một "migration/seed job" riêng. Migration (`prisma migrate deploy`) vẫn chạy được vì `prisma` (CLI) nằm ở devDeps — cũng bị prune; ⇒ nếu cần chạy migrate trong container prod, giữ `prisma` CLI hoặc dùng job riêng. **Với dev/compose hiện tại thì không ảnh hưởng.**

---

## 4. Kiểm tra Docker Best Practice

| Tiêu chí | Trạng thái |
|---|---|
| Multi-stage build (deps → build → runtime) | ✅ |
| Base image pin phiên bản | ✅ node:22-alpine, postgres:16-alpine, redis:7-alpine, dpage/pgadmin4:8.14 |
| Chạy non-root (`USER node`) | ✅ |
| `npm ci` (deterministic) | ✅ |
| Prune devDependencies ở runtime | ✅ |
| `.dockerignore` loại node_modules/dist/.env/.git | ✅ |
| Không hardcode secret trong compose | ✅ (đã chuyển sang `.env`) |
| Healthcheck cho postgres/redis/api | ✅ |
| Named volumes (postgres/redis/pgadmin) | ✅ |
| `depends_on` + `condition: service_healthy` | ✅ |
| Build tools chỉ ở stage build, không ở runtime | ✅ |

**Khuyến nghị (không chặn):**
- 🟡 Thêm `init: true` cho service `api` trong compose để chuyển tiếp tín hiệu (SIGTERM) sạch hơn (Node vẫn xử lý shutdown hooks, nhưng `init` là best practice).
- 🟡 Cân nhắc `deploy.resources.limits` (mem/cpu) khi lên production.
- 🟡 `PGADMIN_CONFIG_SERVER_MODE=False` chỉ hợp cho local dev (bỏ qua master password). Không dùng cấu hình này ở production.

---

## 5. Bảo mật cấu hình

- ✅ Secret nạp từ `.env` (dev) / secret manager (prod) — không hardcode (ADR-020).
- ✅ `.env` nằm trong `.gitignore`; chỉ commit `.env.example` với placeholder `change-me-*`.
- ✅ Env validate fail-fast bằng Joi khi khởi động app.
- ✅ Logger redact PII/secret (ADR-024).

---

## 6. Tổng kết

- Tất cả 6 việc chuẩn hóa đã hoàn tất; vấn đề chặn (bcrypt native build) đã được sửa.
- Các mục 🟡 còn lại là **khuyến nghị vận hành**, không chặn việc bắt đầu implement Auth.
- Cấu hình project (package.json, tsconfig, eslint/prettier, husky, docker/compose, env, health, logger, global exception, validation, Swagger, Prisma, Redis) đã đầy đủ và nhất quán.

# ✅ READY TO IMPLEMENT AUTH MODULE

> Bước tiếp theo (khi có yêu cầu): implement module Auth theo `docs/auth.md` + workflow ADR-019, dưới `src/modules/auth/`.
> Không sinh Authentication/API/NestJS module/Frontend trong phạm vi hiện tại.
