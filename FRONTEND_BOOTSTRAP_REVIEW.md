# FRONTEND BOOTSTRAP REVIEW — NCMedia Management Platform

> **Vai trò:** Frontend Tech Lead · **Loại:** Bootstrap review
> **Ngày:** 2026-07-15 · **App:** `apps/frontend` · **Trạng thái:** ✅ Bootstrap hoàn tất (build PASS)
> **Nguồn tuân thủ:** `.claude/CLAUDE.md` (Mục 7, 9, 12), `architecture/ADR.md` (ADR-017, 022, 023, 006/021), `PROJECT_STRUCTURE_PROPOSAL.md`
>
> Phạm vi: **chỉ bootstrap**. KHÔNG implement Login / Register / Dashboard / Employee / Order.

---

## 1. Kết quả kiểm chứng (bắt buộc)

| Bước | Lệnh | Kết quả |
|---|---|---|
| Cài dependencies | `npm install` | ✅ PASS — 399 packages, `INSTALL_EXIT=0` |
| Lint | `npm run lint` (`next lint`) | ✅ PASS — *No ESLint warnings or errors* |
| Build production | `npm run build` (`next build`) | ✅ PASS — *Compiled successfully*, type-check OK, `BUILD_EXIT=0` |

**Build output tóm tắt:**
```
Route (app)                    Size      First Load JS
┌ ○ /                          136 B     105 kB
└ ○ /_not-found                979 B     106 kB
+ First Load JS shared by all            105 kB
ƒ Middleware                   31.9 kB
○ (Static) prerendered as static content
```
Tất cả route render **static** — đúng kỳ vọng cho bootstrap (chưa có data fetching động).

---

## 2. Công nghệ đã cài đặt (theo đúng yêu cầu)

| Nhóm | Thư viện | Phiên bản |
|---|---|---|
| Framework | `next` | 15.1.7 |
| UI runtime | `react`, `react-dom` | 19.0.0 |
| Ngôn ngữ | `typescript` | ^5.7.3 |
| CSS | `tailwindcss` (+ `postcss`, `autoprefixer`) | ^3.4.17 |
| Design system | shadcn/ui foundation (`class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`, `@radix-ui/react-slot`) | — |
| Icon | `lucide-react` | ^0.475.0 |
| Client state | `zustand` | ^5.0.3 |
| Server state | `@tanstack/react-query` | ^5.66.0 |
| HTTP | `axios` | ^1.7.9 |
| Form + Validation | `react-hook-form`, `zod`, `@hookform/resolvers` | ^7 / ^3 / ^3 |
| Auth token | `js-cookie` (+ `@types/js-cookie`) | ^3.0.5 |
| Code quality | `eslint` (8.57), `eslint-config-next`, `eslint-config-prettier`, `prettier`, `prettier-plugin-tailwindcss` | — |

> **Quyết định kỹ thuật (Tech Lead):**
> - **TailwindCSS v3.4** (không v4): tương thích ổn định & được kiểm chứng với shadcn/ui, giảm rủi ro build.
> - **ESLint 8 + `.eslintrc.json`** (không flat-config v9): `next lint` chạy tin cậy, tránh ma sát cấu hình.
> - **KHÔNG dùng `next/font/google`**: tránh phụ thuộc tải font qua mạng lúc build (dùng font-stack hệ thống).

---

## 3. Cấu trúc thư mục đã tạo

Đúng theo yêu cầu (`app / components / features / hooks / lib / providers / services / stores / styles / types / utils / middleware.ts`):

```
apps/frontend/
├── app/
│   ├── layout.tsx           # Root layout: metadata + <Providers> + import globals.css
│   └── page.tsx             # Trang trạng thái bootstrap (placeholder — KHÔNG phải Dashboard)
├── components/
│   ├── ui/button.tsx        # Primitive shadcn/ui (cva + Slot) — chứng minh UI stack
│   └── README.md            # quy ước component dùng chung
├── features/
│   └── README.md            # quy ước feature-based (rỗng — chưa implement feature)
├── hooks/
│   └── use-mounted.ts       # hook nền tảng (SSR-safe)
├── lib/
│   ├── utils.ts             # cn() — gộp className (shadcn convention)
│   └── env.ts               # truy cập env typed (có fallback)
├── providers/
│   ├── index.tsx            # gom client providers
│   └── query-provider.tsx   # TanStack React Query provider
├── services/
│   └── api-client.ts        # Axios instance + interceptor đính Bearer token (hạ tầng)
├── stores/
│   └── ui.store.ts          # Zustand store mẫu (UI) — minh hoạ pattern
├── styles/
│   └── globals.css          # Tailwind directives + CSS variables (slate, light/dark)
├── types/
│   ├── api.ts               # Envelope + errors[] + pagination (ADR-022/023)
│   └── index.ts             # re-export
├── utils/
│   └── http.ts              # trích message/field-error từ AxiosError
├── middleware.ts            # Next middleware (passthrough — chưa có auth guard)
├── components.json          # cấu hình shadcn/ui CLI (thêm component sau)
├── next.config.ts  tsconfig.json  tailwind.config.ts  postcss.config.mjs
├── .eslintrc.json  .prettierrc.json  .prettierignore  .gitignore  .env.example
└── package.json  package-lock.json  next-env.d.ts  README.md
```

---

## 4. Tuân thủ hợp đồng Backend (ADR)

Đã dựng sẵn (không implement nghiệp vụ) để feature sau ráp vào nhanh:

- **Envelope response** `{ success, code, message, data, timestamp }` + **`errors[]`** → `types/api.ts` (CLAUDE.md Mục 12, **ADR-022**).
- **Pagination page/limit** + `meta{ total, page, limit, totalPages }` → `PaginationParams` / `Paginated<T>` (**ADR-023**).
- **API base** `/api/v1` qua `NEXT_PUBLIC_API_BASE_URL` → `lib/env.ts`, `services/api-client.ts` (CLAUDE.md Mục 12).
- **Auth token** đọc từ cookie (`js-cookie`) đính `Authorization: Bearer` — chỉ *plumbing*, **chưa** có logic Login/Refresh/Rotation (**ADR-006/021** để feature Auth triển khai).

---

## 5. Ranh giới phạm vi (đã tôn trọng)

| Yêu cầu | Trạng thái |
|---|---|
| Bootstrap project | ✅ Hoàn tất |
| Login / Register | 🚫 KHÔNG implement |
| Dashboard | 🚫 KHÔNG implement |
| Employee / Order | 🚫 KHÔNG implement |
| Business logic | 🚫 KHÔNG có |

`app/page.tsx` chỉ là trang trạng thái xác nhận UI stack hoạt động; `middleware.ts` là passthrough; `stores/ui.store.ts` là store UI mẫu — không phải nghiệp vụ.

---

## 6. ⚠️ Phát hiện cần xử lý (Action Items)

### A1 — 🔴 Lỗ hổng bảo mật ở `next@15.1.7` (CVE-2025-66478) *(Ưu tiên cao)*
`npm install` cảnh báo: *"This version has a security vulnerability. Please upgrade to a patched version."*
Bootstrap hiện chốt version để đảm bảo build xanh; **cần nâng lên bản 15.x đã vá** trước khi phát triển tính năng:
```bash
cd apps/frontend
npm install next@15 eslint-config-next@15
npm run build   # xác nhận vẫn xanh
```
> Tôi chưa tự nâng vì phạm vi lệnh là *bootstrap → build PASS → sinh report → dừng*. Có thể thực hiện ngay khi được duyệt.

### A2 — 🟡 Chưa nối vào monorepo/workspace
`apps/frontend` hiện là app standalone (giống `apps/backend`). Chưa có root workspace quản lý chung (đúng phạm vi các lệnh trước). Khi làm Phase tiếp theo, cân nhắc root `package.json` (npm workspaces) + `packages/shared` để dùng chung `types/api.ts` với backend.

### A3 — 🟢 `.env.local` chưa tạo
Chỉ có `.env.example`. Trước khi `npm run dev` nối API thật, tạo `.env.local` từ mẫu.

### A4 — 🟢 shadcn/ui mới có `Button`
Mới thêm 1 primitive để chứng minh setup. Các primitive khác (Input, Form, Dialog, Toast...) thêm dần bằng `npx shadcn@latest add <component>` khi làm form Login/Register (Sprint sau).

---

## 7. Kết luận

Bootstrap Frontend **đạt Definition of Done cho phạm vi bootstrap**: đầy đủ stack yêu cầu, cấu trúc production-ready đúng đặc tả, **lint sạch, build production thành công**, không lẫn business logic. Sẵn sàng cho bước phát triển feature theo workflow ADR-019 — **bắt đầu bằng việc vá A1 (CVE)**.

*Dừng tại đây theo yêu cầu (build PASS → sinh report → stop).*
