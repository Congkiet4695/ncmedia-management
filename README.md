# NCMedia Management Platform — Backend

Backend cho **NCMedia Management Platform** — hệ quản lý vận hành doanh nghiệp thương mại điện tử đa nền tảng.

- **Kiến trúc:** Modular Monolith · Multi-Tenant · REST API · Clean Architecture (Pragmatic) · DDD Inspired (xem `architecture/ADR.md`).
- **Trạng thái:** Sprint 1 — *khởi tạo project production-ready*. **Chưa** implement business/Authentication.

> Nguồn kiến trúc: `.claude/CLAUDE.md`, `architecture/ADR.md`. Tài liệu module: `docs/`.

---

## 1. Tech Stack

| Nhóm | Công nghệ |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5.7 |
| Framework | NestJS 11 |
| ORM / DB | Prisma 6 · PostgreSQL 16 |
| Cache | Redis 7 (ioredis) |
| Docs | Swagger (OpenAPI) |
| Logger | nestjs-pino (structured, PII-redacted) |
| Validation | class-validator + ValidationPipe + Joi (env) |
| Chất lượng | ESLint 9 (flat) · Prettier · Husky · lint-staged |
| Hạ tầng | Docker · docker-compose |

---

## 2. Yêu cầu

- Node.js ≥ 22
- Docker + Docker Compose (cho Postgres/Redis)
- npm ≥ 10

---

## 3. Khởi động nhanh (Local)

```bash
# 1) Cài dependencies
npm install

# 2) Tạo file env
cp .env.example .env      # Windows: copy .env.example .env

# 3) Chạy hạ tầng (Postgres 16 + Redis 7)
docker compose up -d postgres redis

# 4) Sinh Prisma Client + chạy migration + seed
npm run prisma:generate
npm run prisma:migrate     # áp dụng migration đầu tiên
npm run db:seed            # seed Organization Demo + Roles + Admin

# 5) Chạy API (watch mode)
npm run start:dev
```

API mặc định: `http://localhost:3000/api/v1`
Swagger UI: `http://localhost:3000/api/v1/docs`

---

## 4. Chạy toàn bộ bằng Docker

```bash
cp .env.example .env
docker compose up -d --build
# API: http://localhost:3000/api/v1
```

> Lưu ý: container `api` không tự chạy migration. Sau khi services khỏe mạnh:
> ```bash
> docker compose exec api npx prisma migrate deploy
> docker compose exec api npm run db:seed
> ```

---

## 5. Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run start:dev` | Chạy watch mode |
| `npm run start:prod` | Chạy bản build (`dist/`) |
| `npm run build` | Biên dịch TypeScript |
| `npm run lint` | ESLint --fix |
| `npm run format` | Prettier |
| `npm test` | Unit test (Jest) |
| `npm run prisma:migrate` | Migration (dev) |
| `npm run prisma:deploy` | Migration (production) |
| `npm run db:seed` | Seed dữ liệu mặc định |
| `npm run prisma:studio` | Prisma Studio |

---

## 6. Health Check

| Endpoint | Ý nghĩa |
|---|---|
| `GET /api/v1/health` | Liveness (tiến trình còn sống) |
| `GET /api/v1/health/ready` | Readiness (kiểm tra PostgreSQL + Redis) — trả `503` nếu phụ thuộc chưa sẵn sàng |

---

## 7. Cấu trúc thư mục

```
src/
  main.ts                 # bootstrap: ValidationPipe, Swagger, Helmet, CORS, global filter/interceptor
  app.module.ts           # ConfigModule, Logger, Prisma, Redis, Health
  config/                 # configuration + env validation (Joi)
  common/
    filters/              # AllExceptionsFilter (envelope chuẩn)
    interceptors/         # TransformInterceptor (envelope success)
    interfaces/           # ApiResponse
  database/               # PrismaService + PrismaModule (global)
  redis/                  # RedisService + RedisModule (global)
  health/                 # Health controller/module
prisma/
  schema.prisma           # schema (Auth/RBAC)
  migrations/             # migration đầu tiên
  seed.ts                 # seed
```

> Module nghiệp vụ (Authentication, Employee, Order...) sẽ được thêm dưới `src/modules/` ở các sprint sau, theo workflow ADR-019. **Chưa implement trong giai đoạn này.**

---

## 8. Response chuẩn

Mọi response tuân thủ envelope (CLAUDE.md Mục 12 + ADR-022):

```jsonc
// success
{ "success": true, "code": "SUCCESS", "message": "", "errors": null, "data": { }, "timestamp": "..." }

// error (kèm errors[] cho lỗi validate từng field)
{ "success": false, "code": "VALIDATION_ERROR", "message": "Dữ liệu không hợp lệ",
  "errors": [{ "field": "email", "message": "..." }], "data": null, "timestamp": "..." }
```

---

## 9. Biến môi trường

Xem `.env.example`. Env được **validate khi khởi động** (Joi) — thiếu biến bắt buộc sẽ fail-fast.
Các biến JWT/HMAC được khai báo sẵn cho hạ tầng Auth nhưng **Authentication chưa được implement** ở giai đoạn này.

---

## 10. Ghi chú bảo mật

- Helmet, CORS whitelist, ValidationPipe (whitelist + forbidNonWhitelisted).
- Logger **redact PII/secret** (authorization, password, email, token...) theo Decision-018 / ADR-024.
- Secret nạp từ ENV/secret manager — **không hardcode** (ADR-020).
