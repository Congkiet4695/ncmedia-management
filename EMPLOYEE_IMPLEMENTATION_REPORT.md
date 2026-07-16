# EMPLOYEE — Implementation Report

> Module: **Employee** (module nghiệp vụ đầu tiên) · Sprint 2
> Product: **NCMedia Management Platform** · Ngày: 2026-07-15
> Nguồn: `.claude/CLAUDE.md`, `architecture/ADR.md`, `docs/database.md`, `docs/auth.md`, `LOGIN_FINAL_REVIEW.md`.
> Phạm vi: **CHỈ Employee**. Không đụng Platform/Shop/Order/Report. Không sửa Login/Register/ADR/Business Rule hiện có.

---

## 1. Database

**Model mới `Employee`** (hồ sơ nghiệp vụ 1-1 với `User` — ADR-007). Tách trách nhiệm:
- `User` giữ auth: `email`, `passwordHash`, `fullName`, `status`, `roleId` (nguồn duy nhất — **không lặp**).
- `Employee` giữ business info: `dateOfBirth`, `salary`, `avatar` + audit + soft delete.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | ADR-005 |
| organization_id | uuid FK | tenant-scoped (ADR-003/004) |
| user_id | uuid FK **unique** | 1-1 với User |
| date_of_birth | date NULL | |
| salary | **decimal(15,2)** default 0 | VND, CHECK `>= 0` |
| avatar | varchar(1024) NULL | |
| created_at/updated_at/deleted_at/created_by/updated_by | | audit + soft delete (ADR-015) |

- Migration: `prisma/migrations/20260715000000_add_employee/migration.sql` (bảng + unique `user_id` + index `organization_id` + FK + CHECK salary).
- `prisma generate` đã chạy (client có model `Employee`).
- **Không sửa** bảng cũ (chỉ thêm quan hệ `User.employee` / `Organization.employees` và gỡ TODO Sprint-2 trong schema).

---

## 2. API

Base `/api/v1`. Guard: **JwtAuthGuard + AdminGuard** (ADMIN-only; role khác → 403). Envelope chuẩn + `errors[]`.

| Method & Path | Mô tả | Response |
|---|---|---|
| `POST /employees` | Tạo Employee (auto-gen password, gán Role) | `201` `CreateEmployeeResponseDto` (+ `temporaryPassword`) |
| `GET /employees` | Danh sách: filter/search/sort/pagination | `200` `{ items, meta }` |
| `GET /employees/:id` | Chi tiết | `200` `EmployeeResponseDto` |
| `PATCH /employees/:id` | Cập nhật | `200` `EmployeeResponseDto` |
| `DELETE /employees/:id` | **Soft delete** | `200` `data: null` |
| `GET /roles` *(hỗ trợ)* | Danh sách Role để chọn khi tạo | `200` `RoleResponseDto[]` |

- **List query:** `page, limit, fullname, email, status, roleId, search, sortBy, sortOrder`.
  - Filter fullname/email (contains), status, role; `search` = OR(fullname,email); sort theo `createdAt|fullName|email|salary|status`.
  - `meta: { total, page, limit, totalPages }` (ADR-023).
- **Error codes:** `EMPLOYEE_EMAIL_EXISTS` (409), `EMPLOYEE_NOT_FOUND` (404), `EMPLOYEE_ROLE_INVALID` (400), `AUTH_TOKEN_INVALID` (401), `AUTH_FORBIDDEN` (403), `VALIDATION_ERROR` (400).
- Swagger đầy đủ (`@ApiTags/@ApiBearerAuth/@ApiOperation/@Api*Response`).

> `GET /roles` là endpoint hỗ trợ (đã đặc tả ở auth.md §16) để selector "chọn Role khi tạo" hoạt động với Role động (ADR-009) — không hardcode.

---

## 3. Backend

Cấu trúc `modules/employee` (Clean Architecture, Repository Pattern — CLAUDE.md Mục 9):

- **Controller** `employee.controller.ts` — chỉ điều hướng, không business logic; `ParseUUIDPipe` cho `:id`.
- **Service** `employee.service.ts` — điều phối nghiệp vụ + transaction; map lỗi P2002.
- **Repository** `employee.repository.ts` — data access, **mọi query nhận `organizationId`** (tenant isolation ADR-004); build filter/orderBy.
- **DTO** — `CreateEmployeeDto`, `UpdateEmployeeDto` (PartialType + OmitType email), `EmployeeQueryDto`, `EmployeeResponseDto`/`CreateEmployeeResponseDto`/`PaginatedEmployeeResponseDto`.
- **Mapper** `employee.mapper.ts` — Entity → DTO, **không lộ** `passwordHash`/field nhạy cảm.
- **Exception** — `EmployeeNotFound/EmailExists/RoleInvalid`.
- **Guard** `admin.guard.ts` (auth module, ADMIN-only) + `JwtAuthGuard` (tái sử dụng, export từ AuthModule).
- **Unit test** `employee.service.spec.ts` (skeleton, 8 case).
- **Util** `password-generator.ts` (random entropy cao).

**Transaction** (BR "Create User → Assign Role → Create Employee"):
```
POST /employees → check email unique → resolve Role (mặc định EMPLOYEE)
  → bcrypt hash (cost 12) → prisma.$transaction( create User → create Employee ) → commit
  → trả EmployeeResponseDto + temporaryPassword
```
Soft delete: transaction set `deleted_at` cho **cả** Employee và User (vô hiệu login).

---

## 4. Frontend

Feature `features/employees` (Next.js 15 App Router, TanStack Query, RHF + Zod, shadcn/ui). **Không** thêm dependency mới; UI dựng bằng phần tử gốc theo phong cách shadcn (không Material UI / Ant Design).

**Pages** (dưới `/dashboard`, bảo vệ bởi middleware + AuthProvider + `RequireAdmin`):
- `/dashboard/employees` — list: filter + table + pagination + dialog View/Delete.
- `/dashboard/employees/create` — form tạo → toast (kèm mật khẩu tạm) → redirect list.
- `/dashboard/employees/[id]` — load detail → form sửa → toast → redirect list.

**Components:** `EmployeeTable`, `EmployeeForm`, `EmployeeDialog` (view), `EmployeeFilter`, `EmployeeStatusBadge`, `DeleteDialog`, `RequireAdmin`.
**UI primitives mới:** `table`, `badge`, `avatar`, `native-select`, `modal`.

**Table:** Avatar · Fullname · Email · Role · Salary (định dạng VND) · Status (badge) · Created At · Action (View/Edit/Delete).

**React Query hooks:** `useEmployees`, `useEmployee`, `useCreateEmployee`, `useUpdateEmployee`, `useDeleteEmployee`, `useRoles` — invalidate `['employees']` sau mutation; `keepPreviousData` cho phân trang mượt.

**Zod:** `employeeFormSchema` khớp DTO backend (fullName ≥2, email, salary ≥0, dob ISO).
**Responsive:** grid/flex, table scroll-x, filter xếp dọc trên mobile.

---

## 5. Business Rule

| BR | Thực hiện |
|---|---|
| Email global unique | `repo.emailExists` (toàn bảng users) + unique index + map P2002 |
| Password auto generate | `generateTemporaryPassword()` (random, entropy cao) |
| Password bcrypt cost 12 | `bcrypt.hash(pwd, 12)` |
| Role mặc định Employee | `resolveRole` → `findRoleByCode(EMPLOYEE)` khi bỏ trống |
| Role chọn khi tạo | `roleId` optional; verify thuộc org (`findRoleInOrg`) |
| Status mặc định ACTIVE | `dto.status ?? ACTIVE` |
| Salary mặc định 0, `>= 0` | default 0 (DB) + `@Min(0)` + CHECK |
| Admin không sửa Organization | `organizationId` không có trong DTO; luôn lấy từ token |
| Employee không tự sửa Role | Chỉ ADMIN truy cập module (AdminGuard → 403) |
| Soft delete, không hard delete | `deleted_at` cho Employee + User; query luôn `deletedAt: null` |
| Tenant Isolation (ADR-004) | Mọi repo query nhận `organizationId`; list/detail/update/delete scoped theo org |

---

## 6. Authentication

- Toàn bộ module dùng **AuthProvider + Access Token + GET /me** (đã có từ Sprint trước).
- **Backend:** `JwtAuthGuard` (verify HS256, gắn `request.user`) → `AdminGuard` (role ≠ ADMIN → **403 AUTH_FORBIDDEN**). `organizationId`/`userId` lấy từ token (`@CurrentUser`).
- **Frontend:** `RequireAdmin` chặn UI cho role khác ADMIN (hiển thị 403); axios 401 interceptor → clearSession → `/login`; middleware chặn `/dashboard/*` khi chưa đăng nhập.

---

## 7. Build Result

**Backend** — `npm run build`: ✅ `nest build` không lỗi TypeScript.
**Frontend** — `npm run build`: ✅ `next build` Compiled successfully · type-check pass · 9/9 pages · **không warning**.
**Frontend** — `npm run lint`: ✅ No ESLint warnings or errors.

Routes build: `/dashboard/employees`, `/dashboard/employees/create`, `/dashboard/employees/[id]` (+ các route cũ).

---

## 8. Test Result

**Backend** — `npm test`:
```
Test Suites: 9 passed, 9 total
Tests:       21 todo, 25 passed, 46 total
```
`EmployeeService` (`employee.service.spec.ts`) — 8 case xanh:
- ✓ defined · ✓ email tồn tại → `EMPLOYEE_EMAIL_EXISTS`
- ✓ không chọn Role → dùng EMPLOYEE + trả `temporaryPassword` (không lộ `passwordHash`)
- ✓ roleId không thuộc org → `EMPLOYEE_ROLE_INVALID`
- ✓ findOne không tồn tại → `EMPLOYEE_NOT_FOUND`
- ✓ findAll → items + meta phân trang
- ✓ remove → soft delete trong transaction · ✓ remove không tồn tại → `EMPLOYEE_NOT_FOUND`

> Frontend: dự án chưa cấu hình test runner → kiểm chứng qua `build` + `lint` (theo yêu cầu).

---

## 9. File đã tạo

**Backend (20):**
- `prisma/migrations/20260715000000_add_employee/migration.sql`
- `src/modules/auth/guards/admin.guard.ts`, `src/modules/auth/dto/role-response.dto.ts`, `src/modules/auth/roles.controller.ts`
- `src/modules/employee/`: `employee.module.ts`, `employee.controller.ts`
  - `services/employee.service.ts`, `services/employee.service.spec.ts`
  - `repositories/employee.repository.ts`
  - `mappers/employee.mapper.ts`
  - `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts`, `dto/employee-query.dto.ts`, `dto/employee-response.dto.ts`
  - `exceptions/employee-not-found.exception.ts`, `exceptions/employee-email-exists.exception.ts`, `exceptions/employee-role-invalid.exception.ts`
  - `types/employee-with-relations.type.ts`, `constants/employee.constants.ts`, `utils/password-generator.ts`

**Frontend (21):**
- `lib/format.ts`
- `components/ui/`: `table.tsx`, `badge.tsx`, `avatar.tsx`, `native-select.tsx`, `modal.tsx`
- `features/employees/`: `types.ts`, `schemas/employee.schema.ts`, `services/employee.service.ts`, `hooks/use-employees.ts`, `utils/form-payload.ts`
  - `components/`: `employee-table.tsx`, `employee-form.tsx`, `employee-dialog.tsx`, `employee-filter.tsx`, `employee-status-badge.tsx`, `delete-dialog.tsx`, `require-admin.tsx`
- `app/(dashboard)/dashboard/employees/`: `page.tsx`, `create/page.tsx`, `[id]/page.tsx`

---

## 10. File đã sửa

**Backend (5):**
- `prisma/schema.prisma` — thêm model `Employee` + quan hệ `User.employee`/`Organization.employees` (gỡ TODO Sprint-2).
- `src/modules/auth/constants/default-roles.ts` — thêm `EMPLOYEE_ROLE_CODE`.
- `src/modules/auth/services/role.service.ts` — thêm `findManyByOrganization`.
- `src/modules/auth/auth.module.ts` — đăng ký `RolesController` + `AdminGuard`; export `JwtAuthGuard`/`AdminGuard`.
- `src/app.module.ts` — import `EmployeeModule`.

**Frontend (2):**
- `app/(dashboard)/layout.tsx` — thêm menu "Nhân viên"; dùng `Avatar` dùng chung (bỏ trùng lặp initials).
- `app/(dashboard)/dashboard/_components/profile-summary.tsx` — dùng `Avatar` dùng chung.

---

## Ghi chú thiết kế (trong phạm vi, tuân ADR)

1. **`avatar`/`dateOfBirth`** thuộc Employee (đúng ADR-007). `fullName/email/status/role` lấy từ `User` (nguồn duy nhất) → **không duplicate** dữ liệu.
2. **Mật khẩu tạm** trả **một lần** trong response tạo (`temporaryPassword`) vì chưa có luồng gửi email (Forgot/Reset là S2+). Không lưu plaintext; không xuất hiện ở GET/LIST/PATCH.
3. **Salary** dùng `Decimal(15,2)` (chính xác tiền tệ), map ra `number` trong response.
4. **AdminGuard** là kiểm tra role tối thiểu cho module này — **không** phải hệ thống Permission RBAC đầy đủ (ngoài phạm vi).

> **Kết luận:** Module Employee production-ready: tenant-isolated, không mock/TODO/demo, build/test/lint xanh. Chỉ hoàn thành Employee — không mở rộng sang Platform/Shop/Order/Report.
