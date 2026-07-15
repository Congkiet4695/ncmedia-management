# PROJECT STRUCTURE PROPOSAL — NCMedia Management Platform

> **Loại tài liệu:** Đề xuất tái cấu trúc thư mục (analysis only)
> **Ngày:** 2026-07-15 · **Trạng thái:** Draft — chờ Product Owner duyệt
> **Nguồn đối chiếu:** `.claude/CLAUDE.md` (Mục 7, 9), `architecture/ADR.md`, README.md
>
> ⚠️ Tài liệu này **CHỈ phân tích và đề xuất**. **KHÔNG di chuyển bất kỳ file nào. KHÔNG sửa code.**
> Mọi thay đổi thực tế chỉ thực hiện sau khi PO duyệt, theo workflow ADR-019.

---

## 0. Tóm tắt điều hành (Executive Summary)

Repo hiện tại là **backend-only** với NestJS đặt ngay ở thư mục gốc, trong khi `CLAUDE.md` Mục 7 xác định NCMedia là **platform gồm cả Frontend (Next.js) lẫn Backend (NestJS)**. Cấu trúc hiện tại **không có chỗ** cho Frontend, tài liệu bị rải rác ở root, và **thiếu** các thành phần production-ready bắt buộc: CI/CD, scripts vận hành, thư mục hạ tầng (docker/nginx), và package chia sẻ hợp đồng dữ liệu FE↔BE.

**Đề xuất chính:** chuyển sang **Monorepo (npm workspaces)** với `apps/` (backend, frontend) + `packages/shared` + thư mục hạ tầng/tài liệu/CI được chuẩn hóa. Việc chuyển đổi **không đụng tới logic code** (chỉ di chuyển thư mục + cập nhật config path), nên rủi ro thấp và có thể làm theo giai đoạn.

---

## 1. Cấu trúc hiện tại (Current Structure)

Ảnh chụp thực tế (bỏ qua `node_modules/`, `dist/`):

```
ncmedia-management/
├── .claude/
│   ├── CLAUDE.md                     # Source of Truth cho AI
│   ├── REVIEW.md
│   └── settings.local.json
├── .husky/
│   └── pre-commit
├── architecture/
│   └── ADR.md                        # ADR-001 → ADR-024
├── docs/
│   ├── auth.md                       # tài liệu module Auth
│   ├── auth-decisions.md
│   └── database.md
├── prisma/
│   ├── migrations/
│   │   ├── 20260714000000_init/migration.sql
│   │   └── migration_lock.toml
│   ├── schema.prisma
│   └── seed.ts
├── src/                              # ← Backend NestJS nằm thẳng ở root
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/{filters,interceptors,interfaces}/
│   ├── config/{configuration.ts,env.validation.ts}
│   ├── database/{prisma.module.ts,prisma.service.ts}
│   ├── health/{health.controller.ts,health.module.ts}
│   ├── redis/{redis.module.ts,redis.service.ts}
│   └── modules/
│       └── auth/
│           ├── auth.module.ts
│           ├── register.controller.ts
│           ├── constants/  dto/  exceptions/
│           └── services/   (*.service.ts + *.service.spec.ts co-located)
├── test/
│   └── jest-e2e.json                 # ← chỉ có config, KHÔNG có e2e test thật
├── AUTH_FINAL_REVIEW.md              # ← tài liệu review rải ở root
├── DATABASE_CHANGELOG.md             # ← changelog rải ở root
├── DATABASE_FINAL_REVIEW.md          # ← rải ở root
├── PROJECT_BOOTSTRAP_REVIEW.md       # ← rải ở root
├── CHANGELOG.md
├── README.md
├── Dockerfile                        # ← hạ tầng để trần ở root
├── docker-compose.yml                # ← hạ tầng để trần ở root
├── .dockerignore  .env  .env.example
├── .gitignore  .prettierignore  .prettierrc
├── eslint.config.mjs  nest-cli.json
├── package.json (name: ncmedia-management-backend)
├── package-lock.json
├── tsconfig.json  tsconfig.build.json
```

**Nhận xét nhanh theo 9 hạng mục yêu cầu:**

| Hạng mục | Hiện trạng |
|---|---|
| Backend (NestJS) | ✅ Có, nhưng đặt ở **root** (không tách app) |
| Frontend (Next.js) | ❌ **Chưa tồn tại** (mâu thuẫn CLAUDE.md Mục 7) |
| Documentation | ⚠️ Có `docs/` nhưng **rải rác** thêm nhiều `.md` ở root |
| Architecture | ✅ `architecture/ADR.md` (ổn) |
| Docker | ⚠️ `Dockerfile` + `docker-compose.yml` để trần ở root; **chưa có Nginx**, chưa tách prod/override |
| CI/CD | ❌ **Không có** `.github/workflows/` |
| Scripts | ❌ **Không có** thư mục `scripts/` |
| Prisma | ✅ `prisma/` ở root (hợp lý khi backend-only; cần định vị lại khi có FE) |
| Tests | ⚠️ Unit co-located (tốt); **e2e chỉ có config, chưa có test** |

---

## 2. Vấn đề (Problems)

### P1 — Backend chiếm root, không có chỗ cho Frontend *(Nghiêm trọng)*
`package.json` tên `ncmedia-management-backend` và `src/` NestJS nằm ngay gốc repo. `CLAUDE.md` Mục 7 yêu cầu Frontend Next.js + folder `app/ components/ hooks/ services/ stores/ types/ utils/ styles/`. Không thể thêm FE mà không đè lên cấu trúc backend hiện tại. Root repo (tên "platform") đang bị đồng nhất với "backend".

### P2 — Tài liệu rải rác ở root *(Trung bình)*
4 file bị đặt ở root thay vì trong `docs/`: `AUTH_FINAL_REVIEW.md`, `DATABASE_FINAL_REVIEW.md`, `PROJECT_BOOTSTRAP_REVIEW.md`, `DATABASE_CHANGELOG.md`. Không có phân loại (module docs vs review vs changelog). Quy ước đặt tên lẫn lộn: `SCREAMING_CASE.md` ở root vs `kebab-case.md` trong `docs/`.

### P3 — Thiếu CI/CD *(Nghiêm trọng cho production)*
Không có `.github/workflows/`. Có sẵn `lint`, `test`, `build`, `prisma:deploy` nhưng không được tự động hóa (không gate PR bằng lint/test/typecheck/build).

### P4 — Thiếu thư mục Scripts vận hành *(Trung bình)*
Không có `scripts/` chứa lệnh bootstrap/dev/reset-db/wait-for-healthy. Hướng dẫn vận hành nằm rải trong README (vd migrate + seed trong container) mà không có script tái sử dụng.

### P5 — Hạ tầng Docker để trần & thiếu Nginx *(Trung bình)*
`Dockerfile` + `docker-compose.yml` nằm ở root; chưa tách `compose.override` (dev) / `compose.prod`; **chưa có cấu hình Nginx** dù `CLAUDE.md` Mục 7 (Infrastructure) và ADR liệt kê Nginx là thành phần reverse proxy.

### P6 — Không có package chia sẻ hợp đồng FE↔BE *(Trung bình, phòng ngừa)*
DTO/response envelope (`ApiResponse`, error codes, enum như `UserStatus`, `OrganizationStatus`) hiện chỉ ở backend. Khi thêm FE, Zod (FE) và class-validator (BE) sẽ **định nghĩa trùng lặp** hợp đồng — nguy cơ lệch contract. Cần `packages/shared`.

### P7 — Tầng test chưa hoàn chỉnh *(Thấp)*
`test/` chỉ có `jest-e2e.json`, chưa có bộ e2e thực tế cho các flow Sprint 1 (Register/Login). Unit `.spec.ts` co-located là tốt và nên giữ.

### P8 — Ownership của Prisma sẽ mơ hồ khi có FE *(Thấp)*
`prisma/` ở root hợp lý lúc backend-only, nhưng khi lên monorepo cần khẳng định Prisma **thuộc backend** để tránh hiểu nhầm là tài nguyên toàn repo.

---

## 3. Cấu trúc mới (Proposed Structure)

**Mô hình khuyến nghị: Monorepo bằng npm workspaces.** (So sánh với phương án khác ở Mục 4.)

```
ncmedia-management/                          # root = platform (không phải backend)
├── apps/
│   ├── backend/                             # ← toàn bộ NestJS hiện tại chuyển vào đây
│   │   ├── src/                             #   (giữ nguyên cây src — KHÔNG đổi import)
│   │   │   ├── main.ts  app.module.ts
│   │   │   ├── common/  config/  database/  redis/  health/
│   │   │   └── modules/auth/...
│   │   ├── test/                            # e2e của backend (jest-e2e.json + *.e2e-spec.ts)
│   │   ├── prisma/                          # ← Prisma thuộc backend (schema, migrations, seed)
│   │   ├── Dockerfile                       # ← Dockerfile backend ở cạnh app
│   │   ├── .dockerignore
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json  tsconfig.build.json
│   │   ├── .env  .env.example               # env riêng backend (local)
│   │   └── package.json  (name: @ncmedia/backend)
│   │
│   └── frontend/                            # ← MỚI: Next.js 15 App Router (placeholder Sprint sau)
│       ├── src/
│       │   ├── app/        # App Router
│       │   ├── components/ hooks/ services/ stores/ types/ utils/ styles/
│       ├── public/
│       ├── Dockerfile
│       ├── next.config.ts  tsconfig.json
│       ├── .env.example
│       └── package.json  (name: @ncmedia/frontend)
│
├── packages/
│   └── shared/                              # ← MỚI: hợp đồng dùng chung FE↔BE
│       ├── src/  (api-response, error-codes, enums, dto-contracts)
│       └── package.json  (name: @ncmedia/shared)
│
├── architecture/                            # GIỮ NGUYÊN VỊ TRÍ (nhiều tài liệu tham chiếu)
│   └── ADR.md
│
├── docs/                                    # chuẩn hóa phân loại
│   ├── modules/
│   │   ├── auth/{auth.md, auth-decisions.md}
│   │   └── database/{database.md}
│   ├── reviews/
│   │   ├── auth-final-review.md
│   │   ├── database-final-review.md
│   │   └── project-bootstrap-review.md
│   └── changelogs/
│       └── database-changelog.md
│
├── docker/                                  # ← MỚI: gom hạ tầng
│   ├── docker-compose.yml                   #   (chuyển từ root)
│   ├── docker-compose.override.yml          #   dev
│   ├── docker-compose.prod.yml              #   prod
│   └── nginx/
│       ├── nginx.conf                       #   reverse proxy (CLAUDE.md Mục 7)
│       └── conf.d/
│
├── .github/                                 # ← MỚI: CI/CD
│   └── workflows/
│       ├── ci.yml                           #   lint + typecheck + test + build (gate PR)
│       └── cd.yml                           #   build image + prisma migrate deploy
│
├── scripts/                                 # ← MỚI: script vận hành/dev
│   ├── dev-bootstrap.sh
│   ├── db-reset.sh
│   ├── wait-for-healthy.sh
│   └── seed.ts (wrapper) — nếu cần
│
├── .husky/                                  # GIỮ Ở ROOT (git hook cấp repo)
│   └── pre-commit
├── .claude/                                 # GIỮ Ở ROOT
│
├── package.json                             # ← MỚI ở root: quản lý workspaces + script tổng
├── package-lock.json                        # ở root (workspaces)
├── tsconfig.base.json                       # ← tsconfig gốc cho các app kế thừa
├── .prettierrc  .prettierignore             # GIỮ Ở ROOT (chia sẻ)
├── eslint.config.mjs                        # config chung ở root (hoặc mỗi app)
├── .gitignore  .env.example (compose)
├── README.md  CHANGELOG.md                  # GIỮ Ở ROOT
```

> **Ghi chú vị trí `architecture/`:** giữ nguyên ở root vì `CLAUDE.md` và nhiều tài liệu tham chiếu đường dẫn `architecture/ADR.md`. Di chuyển sẽ phá vỡ hàng loạt liên kết → **không di chuyển**.

---

## 4. Lý do (Rationale)

### 4.1. Vì sao Monorepo (apps/ + packages/)?
- **CLAUDE.md Mục 7** định nghĩa một *platform* gồm FE + BE → một repo, hai app là mô hình tự nhiên.
- **Chia sẻ hợp đồng dữ liệu** (`packages/shared`): một nguồn duy nhất cho error codes / enums / response envelope → tránh lệch contract giữa Zod (FE) và class-validator (BE) — giải quyết P6.
- **Version & PR đồng bộ**: thay đổi API kéo theo FE trong cùng một PR, dễ review theo workflow ADR-019.
- **Rủi ro code thấp**: chuyển `src/` nguyên khối vào `apps/backend/src/` **không đổi import tương đối** → không sửa logic.

**Phương án thay thế (không khuyến nghị làm mặc định):**

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Monorepo workspaces** *(khuyến nghị)* | Chia sẻ types, PR đồng bộ, 1 CI | Cần cấu hình workspaces, đường dẫn Docker/Prisma đổi |
| B. Giữ backend ở root, FE repo riêng (polyrepo) | Ít xáo trộn hiện tại | Trùng lặp contract, 2 CI, khó đồng bộ; lệch tinh thần "platform" |
| C. Giữ nguyên (không đổi) | 0 công sức | Không production-ready; không có chỗ cho FE |

### 4.2. Vì sao Prisma thuộc `apps/backend/prisma`?
Chỉ backend dùng Prisma (seed `ts-node`, `PrismaService`). Đặt cạnh backend làm rõ ownership (P8) và giữ `DATABASE_URL`/migration trong phạm vi app.

### 4.3. Vì sao gom Docker vào `docker/` + thêm Nginx?
Tách compose theo môi trường (dev/override/prod) là chuẩn production; thêm `nginx/` hiện thực hóa reverse proxy mà ADR/CLAUDE.md Mục 7 đã nêu (P5). Dockerfile đặt cạnh mỗi app để build context rõ ràng.

### 4.4. Vì sao chuẩn hóa `docs/` (modules/reviews/changelogs)?
Root sạch, tài liệu có taxonomy, quy ước tên nhất quán (kebab-case) — giải quyết P2. `architecture/` giữ nguyên để không phá liên kết.

### 4.5. Vì sao thêm `.github/` và `scripts/`?
CI gate chất lượng (lint/typecheck/test/build) là điều kiện của Definition of Done (CLAUDE.md Mục 20) — giải quyết P3. `scripts/` chuẩn hóa thao tác vận hành lặp lại (P4).

---

## 5. Ảnh hưởng (Impact)

> Toàn bộ ảnh hưởng dưới đây là **cấu hình/đường dẫn**, **không phải logic nghiệp vụ**. Import tương đối trong `src/` **không đổi** vì cây `src/` được chuyển nguyên khối.

| # | Hạng mục | Ảnh hưởng & việc cần làm (khi thực thi sau này) | Mức rủi ro |
|---|---|---|---|
| I1 | **npm workspaces** | Tạo `package.json` root khai báo `workspaces: ["apps/*","packages/*"]`; script tổng gọi xuống từng app (vd `npm run -w @ncmedia/backend start:dev`) | Trung bình |
| I2 | **Prisma path** | `package.json` field `prisma.seed` (`ts-node prisma/seed.ts`) và các script `prisma:*` chạy trong `apps/backend`; `DATABASE_URL` không đổi giá trị nhưng đổi thư mục thực thi | Trung bình |
| I3 | **Dockerfile** | `COPY prisma ./prisma`, `COPY . .` giữ được nếu build context = `apps/backend`; cần cập nhật context | Trung bình |
| I4 | **docker-compose** | `build.context: .` → `../apps/backend` (hoặc dùng path tương đối từ `docker/`); biến env & volume giữ nguyên giá trị | Trung bình |
| I5 | **jest** | `jest.rootDir: src` tương đối trong `apps/backend` → giữ được; e2e `test/jest-e2e.json` theo app | Thấp |
| I6 | **tsconfig** | Tách `tsconfig.base.json` ở root; mỗi app `extends` base; path alias `@ncmedia/shared` cần khai báo | Trung bình |
| I7 | **ESLint/Prettier/Husky** | `lint-staged` glob `*.ts` vẫn chạy; đường dẫn husky `pre-commit` giữ ở root; có thể cần trỏ tới app | Thấp |
| I8 | **Tài liệu tham chiếu** | README, CLAUDE.md nếu mô tả đường dẫn `docs/auth.md` cần cập nhật thành `docs/modules/auth/auth.md`; **`architecture/ADR.md` giữ nguyên** nên các tham chiếu ADR **không đổi** | Thấp |
| I9 | **CI/CD mới** | Thêm workflow; cần secrets (DATABASE_URL test, JWT secrets) trong GitHub Actions | Thấp (bổ sung, không phá vỡ) |
| I10 | **`.env` cho compose** | Compose (ở `docker/`) đọc `.env` — cần quyết định `.env` compose ở root vs `docker/`; backend local đọc `apps/backend/.env` | Trung bình |
| I11 | **Import code** | **Không thay đổi** — đây là lý do chọn di chuyển nguyên khối | Không |

**Thứ tự thực thi đề xuất (giảm rủi ro, khi được duyệt):**
- **Giai đoạn 0 — chỉ tài liệu (rủi ro thấp nhất):** gom docs/reviews/changelogs, cập nhật liên kết. Không đụng code/build.
- **Giai đoạn 1 — backend → `apps/backend`:** di chuyển `src/ test/ prisma/` + config; cập nhật I1–I7; chạy `build`+`test` xác nhận xanh.
- **Giai đoạn 2 — hạ tầng & CI:** tạo `docker/`, `.github/`, `scripts/`; cập nhật compose/Dockerfile context.
- **Giai đoạn 3 — nền FE & shared:** khởi tạo `apps/frontend` (Sprint FE) và `packages/shared`.

---

## 6. Danh sách file cần di chuyển (Move List)

> **Chỉ là kế hoạch — KHÔNG thực hiện trong tài liệu này.** `→` là đường dẫn đích đề xuất.

### 6.1. Backend → `apps/backend/` (Giai đoạn 1)

| Hiện tại | Đề xuất |
|---|---|
| `src/**` (toàn bộ) | `apps/backend/src/**` |
| `test/jest-e2e.json` | `apps/backend/test/jest-e2e.json` |
| `prisma/**` (schema, migrations, seed.ts) | `apps/backend/prisma/**` |
| `Dockerfile` | `apps/backend/Dockerfile` |
| `.dockerignore` | `apps/backend/.dockerignore` |
| `nest-cli.json` | `apps/backend/nest-cli.json` |
| `tsconfig.json` | `apps/backend/tsconfig.json` (extends `../../tsconfig.base.json`) |
| `tsconfig.build.json` | `apps/backend/tsconfig.build.json` |
| `.env` | `apps/backend/.env` |
| `.env.example` | `apps/backend/.env.example` (+ giữ 1 bản cho compose ở `docker/`) |
| `package.json` | `apps/backend/package.json` (đổi tên `@ncmedia/backend`) + **tạo mới** `package.json` root (workspaces) |

### 6.2. Tài liệu → `docs/**` (Giai đoạn 0)

| Hiện tại (root) | Đề xuất |
|---|---|
| `AUTH_FINAL_REVIEW.md` | `docs/reviews/auth-final-review.md` |
| `DATABASE_FINAL_REVIEW.md` | `docs/reviews/database-final-review.md` |
| `PROJECT_BOOTSTRAP_REVIEW.md` | `docs/reviews/project-bootstrap-review.md` |
| `DATABASE_CHANGELOG.md` | `docs/changelogs/database-changelog.md` |
| `docs/auth.md` | `docs/modules/auth/auth.md` |
| `docs/auth-decisions.md` | `docs/modules/auth/auth-decisions.md` |
| `docs/database.md` | `docs/modules/database/database.md` |

### 6.3. Hạ tầng → `docker/` (Giai đoạn 2)

| Hiện tại | Đề xuất |
|---|---|
| `docker-compose.yml` | `docker/docker-compose.yml` (cập nhật `build.context`) |

### 6.4. Giữ nguyên vị trí (KHÔNG di chuyển)

| File/Thư mục | Lý do |
|---|---|
| `architecture/ADR.md` | Nhiều tài liệu tham chiếu đường dẫn này; di chuyển sẽ phá liên kết |
| `.claude/**` | Cấu hình AI cấp repo |
| `.husky/pre-commit` | Git hook cấp repo |
| `README.md`, `CHANGELOG.md` | Quy ước đặt ở root |
| `.gitignore`, `.prettierrc`, `.prettierignore` | Config chia sẻ toàn repo |
| `eslint.config.mjs` | Config chung (có thể giữ root hoặc nhân bản theo app — quyết định ở I7) |

### 6.5. Thư mục/file cần TẠO MỚI (không phải di chuyển)

- `package.json` (root, workspaces) · `tsconfig.base.json`
- `apps/frontend/**` (Next.js — Sprint FE)
- `packages/shared/**`
- `docker/nginx/**`, `docker/docker-compose.override.yml`, `docker/docker-compose.prod.yml`
- `.github/workflows/{ci.yml,cd.yml}`
- `scripts/**`
- `apps/backend/test/*.e2e-spec.ts` (bổ sung e2e còn thiếu — P7)

---

## 7. Câu hỏi cần Product Owner quyết định (Open Questions)

1. **Monorepo (A) hay giữ backend-at-root + FE polyrepo (B)?** — Đề xuất **A**. Ảnh hưởng toàn bộ move list.
2. **Vị trí `.env` cho docker-compose** sau khi lên `docker/` (root vs `docker/`)? *(I10)*
3. **Có tách compose theo môi trường** (override/prod) ngay không, hay giai đoạn sau?
4. **`eslint.config.mjs`**: giữ 1 config chung ở root hay mỗi app một bản? *(I7)*
5. **Thời điểm khởi tạo `apps/frontend`**: ngay bây giờ (placeholder) hay chờ Sprint FE để tránh scaffold rỗng?

---

*Hết PROJECT_STRUCTURE_PROPOSAL.md — chỉ phân tích & đề xuất; không di chuyển file, không sửa code.*
