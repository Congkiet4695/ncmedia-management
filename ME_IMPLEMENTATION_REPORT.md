# ME — Implementation Report

> Feature: **GET /api/v1/auth/me** + **Frontend Authentication Context**
> Module: Authentication (Sprint 1) · Product: **NCMedia Management Platform** · Ngày: 2026-07-15
> Nguồn: `.claude/CLAUDE.md`, `architecture/ADR.md`, `docs/auth.md`, `docs/login.md`, `docs/database.md`, `LOGIN_FINAL_REVIEW.md`.
> Phạm vi: **CHỈ** `GET /auth/me` (backend) + **Frontend Auth Context**. Không đụng Refresh/Logout API/RBAC/Register/Login backend/Database/ADR.

---

## 1. File đã tạo

### Backend (`apps/backend/src/modules/auth`)
| File | Vai trò |
|---|---|
| `guards/jwt-auth.guard.ts` | `JwtAuthGuard` — verify Access Token (Bearer, HS256), gắn `request.user`; lỗi → 401 `AUTH_TOKEN_INVALID`. |
| `decorators/current-user.decorator.ts` | `@CurrentUser()` — trích `AuthenticatedUser` từ request. |
| `types/authenticated-user.interface.ts` | Interface `AuthenticatedUser` (`userId`, `organizationId`, `role`, `jti`). |
| `exceptions/token-invalid.exception.ts` | `TokenInvalidException` — code `AUTH_TOKEN_INVALID` (401). |
| `dto/me-response.dto.ts` | `MeResponseDto` + `MeOrganizationDto` + `MeRoleDto` (Swagger). |
| `me.controller.ts` | `MeController` — `GET /auth/me`, `@UseGuards(JwtAuthGuard)`. |
| `services/me.service.ts` | `MeService.getMe()` — query tenant-isolated + map response. |
| `services/me.service.spec.ts` | Unit test skeleton (4 case: defined, map, tenant isolation, not-found). |

### Frontend (`apps/frontend`)
| File | Vai trò |
|---|---|
| `features/auth/hooks/use-me.ts` | `useMe()` React Query — key `auth/me`, `retry: false`. |
| `providers/auth-provider.tsx` | `AuthProvider` — App start → check token → GET /me → Zustand → Loading Screen. |
| `hooks/use-auth.ts` | `useAuth()` — expose `user, organization, role, loading, isAuthenticated, logout()`. |
| `app/(dashboard)/dashboard/_components/profile-summary.tsx` | Thẻ hồ sơ: Avatar, Fullname, Organization, Role. |

---

## 2. File đã sửa

### Backend
| File | Thay đổi |
|---|---|
| `modules/auth/auth.module.ts` | Đăng ký `MeController`, `MeService`, `JwtAuthGuard`. |

### Frontend
| File | Thay đổi |
|---|---|
| `features/auth/types.ts` | Thêm `MeProfile`/`MeUser`/`MeOrganization`/`MeRole`; bỏ `SessionPayload`. |
| `features/auth/services/auth.service.ts` | Thêm `getMe()`. |
| `stores/auth.store.ts` | State: `user, organization, role, isAuthenticated, isLoading`; actions `setSession(profile)`, `clearSession()`, `setLoading()`. Bỏ persist; token quản ở cookie. |
| `features/auth/hooks/use-login.ts` | Flow: POST /login → Save Token → GET /me → Save Session → Redirect. |
| `features/auth/hooks/use-register.ts` | Flow: POST /register → Save Token → GET /me → Save Session → Redirect. |
| `providers/index.tsx` | Bọc `AuthProvider` (trong `QueryProvider`). |
| `services/api-client.ts` | Response interceptor: 401 → `clearSession()` → redirect `/login` (trừ endpoint auth công khai). |
| `middleware.ts` | Route guard: `/dashboard/*` không token → `/login`; có token vào `/login|/register` → `/dashboard`. |
| `app/(dashboard)/layout.tsx` | Dùng `useAuth`; Header hiển thị Avatar + Fullname + Role; `logout()` client-side. |
| `app/(dashboard)/dashboard/page.tsx` | Render `ProfileSummary` (Avatar/Fullname/Organization/Role). |

> **KHÔNG sửa:** Database/Prisma schema, ADR, backend Login/Register, Business Rule.

---

## 3. Authentication Flow (Backend `GET /auth/me`)

```
Client → GET /api/v1/auth/me  (Header: Authorization: Bearer <accessToken>)
  → JwtAuthGuard:
      - Tách Bearer token; không có → 401 AUTH_TOKEN_INVALID
      - verifyAsync(HS256, jwt.accessSecret)  → sai/hết hạn → 401 AUTH_TOKEN_INVALID
      - request.user = { userId=sub, organizationId, role, jti }
  → MeController.getMe(@CurrentUser())
  → MeService.getMe():
      - prisma.user.findFirst({ where: { id: userId, organizationId, deletedAt: null },
                                include: { organization, role } })      ← tenant isolation
      - không thấy (đã xóa / khác tenant) → 401 AUTH_TOKEN_INVALID
      - map → MeResponseDto
  → 200 { id, email, fullName, avatar, dateOfBirth, organization{id,name,slug}, role{id,code,name} }
```

- **Không query theo email** — query theo `userId + organizationId` (cả hai từ token) đảm bảo tenant isolation (ADR-004).
- **Không trả:** `passwordHash`, `failedLoginCount`, `lockedUntil`, `refreshToken`, `deletedAt`, `permissions` (chỉ map đúng field cho phép).
- `avatar` / `dateOfBirth` là field **Employee** (ADR-007) — Employee chưa có ở Sprint 1 → luôn `null` (không sửa DB). Giữ trong contract để FE ổn định.

---

## 4. Session Flow (Frontend)

**App start (reload / truy cập trực tiếp):**
```
AuthProvider mount → có Access Token (cookie)?
  ├─ Không → clearSession() → render (public)      (middleware chặn /dashboard → /login)
  └─ Có → useMe() GET /auth/me  (React Query, retry=false)
         ├─ Loading → hiển thị Loading Screen (spinner) toàn màn hình
         ├─ Success → setSession(profile) (Zustand) → render App
         └─ Error(401) → clearSession() → redirect /login
```

**Login / Register:**
```
POST /login|/register → setAuthCookies(tokens) → GET /me
  → setSession(profile) + queryClient.setQueryData(['auth','me']) → router.replace('/dashboard')
  (nếu /me lỗi → clearAuthCookies() rollback → lỗi hiển thị ở form)
```

**401 bất kỳ request (trừ /auth/login, /auth/register):**
```
axios response interceptor → useAuthStore.clearSession() → window.location → /login
```

**Logout (client-side, CHƯA có Logout API):**
```
useAuth().logout() → clearSession() (xóa cookie + state) → removeQueries(['auth','me']) → /login
```

- **Store (Zustand):** `user, organization, role, isAuthenticated, isLoading`.
- **React Query `useMe`:** cache key `auth/me`, `retry: false`.
- **Guard:** middleware (server, theo cookie) + AuthProvider (client, theo /me) + chốt cuối ở DashboardLayout.
- **Dashboard:** Header (Avatar + Fullname + Role) + Sidebar (Organization) + `ProfileSummary` (Avatar/Fullname/Organization/Role). Không nghiệp vụ.

---

## 5. Build Result

**Backend** — `npm run build`:
```
> nest build      ✅ không lỗi TypeScript
```

**Frontend** — `npm run build`:
```
> next build      ✅ Compiled successfully · type-check pass · 7/7 pages · Middleware 32 kB
Route: / , /dashboard , /login , /register  (đều build OK)
```

**Frontend** — `npm run lint`:
```
> next lint       ✅ No ESLint warnings or errors
```

---

## 6. Test Result

**Backend** — `npm test`:
```
PASS  ... 8 suites (organization, role, permission, user, token, login, register, me)
Test Suites: 8 passed, 8 total
Tests:       21 todo, 17 passed, 38 total
```

`MeService` (`me.service.spec.ts`) — 4 case xanh:
- ✓ should be defined
- ✓ trả hồ sơ đã map (organization + role), KHÔNG lộ trường nhạy cảm (passwordHash/failedLoginCount/lockedUntil/deletedAt)
- ✓ tenant isolation: query theo `userId + organizationId + deletedAt=null` (không theo email)
- ✓ user không tồn tại (đã xóa / khác tenant) → `AUTH_TOKEN_INVALID`

> Frontend: chưa có test runner cấu hình trong dự án — kiểm chứng qua `build` + `lint` (theo yêu cầu).

---

## 7. Những gì CHƯA implement (đúng phạm vi — không làm)

- **Refresh Token Flow** (verify/rotate/reuse-detection/revoke).
- **Logout API** (backend) — chỉ logout client-side (`clearSession` + redirect).
- **RBAC / Permission Guard** — `JwtAuthGuard` chỉ xác thực, KHÔNG kiểm tra permission.
- **Forgot / Reset Password, Verify Email**.
- **Employee module** — nên `avatar` / `dateOfBirth` trả `null` (ADR-007, Sprint sau).
- Không sửa Database, ADR, Business Rule, backend Login/Register.

---

> **Kết luận:** `GET /auth/me` + Frontend Auth Context đã hoàn thiện đúng workflow (Login/Register → Save Token → GET /me → Save Session → Dashboard), tenant-isolated, không lộ dữ liệu nhạy cảm. Backend build/test xanh; Frontend build/lint xanh. Không mở rộng ngoài phạm vi.
