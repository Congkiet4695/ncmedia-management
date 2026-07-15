# NCMedia Management Platform — Frontend

Frontend cho **NCMedia Management Platform** (xem `../../.claude/CLAUDE.md`, `../../architecture/ADR.md`).

- **Framework:** Next.js 15 (App Router) · React 19 · TypeScript
- **UI:** TailwindCSS · shadcn/ui · Lucide React
- **State:** Zustand · **Server State:** TanStack React Query
- **HTTP:** Axios · **Form/Validation:** React Hook Form + Zod · **Auth token:** js-cookie
- **Chất lượng:** ESLint · Prettier

> **Trạng thái:** *Bootstrap*. Chưa implement Login/Register/Dashboard/Employee/Order.

## Yêu cầu

- Node.js ≥ 22, npm ≥ 10
- Backend API chạy tại `http://localhost:3000/api/v1` (mặc định)

## Khởi động nhanh

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
npm run dev                     # http://localhost:3000
```

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Chạy dev server |
| `npm run build` | Build production |
| `npm run start` | Chạy bản build |
| `npm run lint` | ESLint (`next lint`) |
| `npm run typecheck` | Kiểm tra TypeScript (`tsc --noEmit`) |
| `npm run format` | Prettier |

## Cấu trúc thư mục

```
apps/frontend/
├── app/              # App Router (layout, page, route)
├── components/       # component dùng chung (ui/ = shadcn primitives)
├── features/         # feature nghiệp vụ (chưa implement)
├── hooks/            # custom hook dùng chung
├── lib/              # tiện ích lõi (cn, env)
├── providers/        # client providers (React Query...)
├── services/         # HTTP client (Axios) + API services
├── stores/           # Zustand stores
├── styles/           # globals.css (Tailwind)
├── types/            # hợp đồng dữ liệu dùng chung (envelope, pagination)
├── utils/            # helper thuần (xử lý lỗi API...)
└── middleware.ts     # Next middleware (passthrough — chưa có auth guard)
```

## Chuẩn tích hợp API

- Base URL: `NEXT_PUBLIC_API_BASE_URL` (mặc định `/api/v1`).
- Envelope + `errors[]`: `types/api.ts` (ADR-022).
- Pagination page/limit: `PaginationParams` / `Paginated<T>` (ADR-023).
