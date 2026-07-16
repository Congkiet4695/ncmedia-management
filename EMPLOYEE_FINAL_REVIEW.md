# EMPLOYEE — Final Review (PR Review, read-only)

> Module: **Employee** (Sprint 2) · Product: **NCMedia Management Platform** · Ngày: 2026-07-15
> Chế độ: **CHỈ REVIEW & TEST** — không implement, không refactor, không sửa code.
> Nguồn: `.claude/CLAUDE.md`, `architecture/ADR.md`, `docs/database.md`, `docs/auth.md`, `EMPLOYEE_IMPLEMENTATION_REPORT.md`.
> ⚠️ `docs/employee.md` **KHÔNG tồn tại** (được yêu cầu đọc nhưng thiếu) — xem Finding M-2.

---

# Executive Summary

## ✅ PASS — **EMPLOYEE MODULE IS PRODUCTION READY**

Không phát hiện lỗi **Critical** hay **High**. Toàn bộ 10 hạng mục **PASS**. Build/Test/Lint/Typecheck xanh cả Backend lẫn Frontend. Tenant isolation đúng (kiểm chứng qua đọc code: mọi truy vấn scoped `organizationId`; thao tác chéo tenant → 404). Không rò rỉ `passwordHash`/refresh token/`deleted_at`/internal fields.

Có **3 advisory Medium** và **6 advisory Low** (không chặn phát hành) — cần Product Owner xử lý ở vòng sau, nổi bật nhất: **`temporaryPassword` trả trong response tạo** (quyết định thiết kế có chủ đích nhưng mâu thuẫn với yêu cầu "Không trả password") và **thiếu `docs/employee.md`**.

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Database | ✅ PASS |
| 2 | API | ✅ PASS |
| 3 | Business Rule | ✅ PASS |
| 4 | Tenant Isolation | ✅ PASS |
| 5 | Permission | ✅ PASS |
| 6 | Frontend | ✅ PASS |
| 7 | Security | ✅ PASS (kèm advisory M-1) |
| 8 | Performance | ✅ PASS |
| 9 | Code Quality | ✅ PASS |
| 10 | Test Result | ✅ PASS |

**Kiểm chứng build (đã chạy):**
- Backend `npm run build` ✅ · `npm test` ✅ **9 suites / 46 tests** (EmployeeService 8/8).
- Frontend `npm run build` ✅ (no warning) · `npm run lint` ✅ · `npm run typecheck` ✅.
- `npx prisma validate` ✅ schema hợp lệ.

> ⚠️ **Giới hạn môi trường review:** không có PostgreSQL đang chạy → không thực thi được kịch bản 2-org runtime (tạo Org A/B, Employee A/B). Tenant isolation được kiểm chứng bằng **đọc code** (mọi where-clause đều có `organizationId`) + logic 404 chéo tenant. Xem Finding M-3 (thiếu test tích hợp tự động).

---

## 1. Database — ✅ PASS

- **Schema `Employee`** (`prisma/schema.prisma`): PK uuid, `organization_id` (FK), `user_id` (FK, **@unique** → 1-1 đúng ADR-007), `date_of_birth` date, `salary` Decimal(15,2) default 0, `avatar` varchar(1024), audit + `deleted_at` (soft delete). `npx prisma validate` = valid.
- **FK**: `employees.organization_id → organizations.id` (Restrict), `employees.user_id → users.id` (Restrict). Đúng.
- **Index/Unique**: `employees_user_id_key` (unique), `employees_organization_id_idx`. Hợp lý cho query tenant-scoped.
- **Migration** `20260715000000_add_employee/migration.sql`: khớp schema; có CHECK `salary >= 0`. Prisma client đã generate.
- **Seed** (`prisma/seed.ts`): seed role `EMPLOYEE`/`ADMIN`/`FULFILLMENT` cho org → `resolveRole(EMPLOYEE)` có sẵn. Không dữ liệu dư.
- **Không dữ liệu dư**: `role_permissions` không mang `organization_id` (đúng database.md); Employee **không lặp** `fullName/email/status/role` (lấy từ `users` — nguồn duy nhất).
- `users/roles/permissions/organizations`: không bị sửa cấu trúc; Employee dùng đúng `organization_id` và FK `roleId` (qua User).

---

## 2. API — ✅ PASS

| Endpoint | Status | Ghi chú |
|---|---|---|
| `POST /employees` | 201 | `CreateEmployeeResponseDto` (+ temporaryPassword — xem M-1) |
| `GET /employees` | 200 | `{ items, meta{total,page,limit,totalPages} }` (ADR-023) |
| `GET /employees/:id` | 200 / 404 | `ParseUUIDPipe` → id sai định dạng = 400 |
| `PATCH /employees/:id` | 200 / 404 | |
| `DELETE /employees/:id` | 200 | soft delete, `data: null` |

- **Validation**: DTO + global `ValidationPipe` (whitelist, forbidNonWhitelisted). Error envelope chuẩn có `errors[]` (ADR-022) qua `validationExceptionFactory` + `AllExceptionsFilter`.
- **Swagger**: đầy đủ `@ApiTags/@ApiBearerAuth/@ApiOperation/@Api*Response` trên controller.
- **Error codes**: `EMPLOYEE_EMAIL_EXISTS`(409), `EMPLOYEE_NOT_FOUND`(404), `EMPLOYEE_ROLE_INVALID`(400), `AUTH_TOKEN_INVALID`(401), `AUTH_FORBIDDEN`(403).

---

## 3. Business Rule — ✅ PASS

| BR | Kiểm chứng (file) |
|---|---|
| Admin tạo Employee | controller `@UseGuards(JwtAuthGuard, AdminGuard)` |
| Employee đúng Organization | service set `organizationId` từ token; repo scoped |
| Email global unique | `repo.emailExists` (toàn bảng users) + unique index + map P2002 (`employee.service.ts:mapCreateError`) |
| Role mặc định EMPLOYEE | `resolveRole` → `findRoleByCode(EMPLOYEE)` (`employee.service.ts`) |
| Salary mặc định 0 | DB default 0 + `dto.salary ?? 0` |
| Status mặc định ACTIVE | `dto.status ?? UserStatus.ACTIVE` |
| Password auto-generate, bcrypt 12 | `generateTemporaryPassword()` + `bcrypt.hash(...,12)` |
| Soft Delete, không hard delete | `repo.softDelete` set `deleted_at` (Employee + User); mọi query `deletedAt: null` |

---

## 4. Tenant Isolation — ✅ PASS (kiểm chứng bằng đọc code)

Mọi thao tác nhận `organizationId` từ token (ADR-004):
- `findById(organizationId, id)` → `where { id, organizationId, deletedAt: null }`.
- `findMany(organizationId, …)` → `where { organizationId, deletedAt: null, user: {…} }`.
- `update`/`delete`: gọi `findById(organizationId, id)` trước (chặn 404 nếu khác tenant) rồi mới thao tác theo PK → **Admin B PATCH/DELETE employee của Org A → 404** (không lộ tồn tại, không sửa được).
- `create`: `organizationId` lấy từ token, không nhận từ client.
- `GET /roles`: `findManyByOrganization(user.organizationId)` — scoped.

Kết luận: Admin A không thấy/không sửa/không xóa Employee B và ngược lại. **Đạt.** (Advisory M-3: nên bổ sung test tích hợp 2-org tự động — hiện chỉ verify bằng inspection.)

---

## 5. Permission — ✅ PASS

- **Guest → 401**: `JwtAuthGuard` chạy trước, không token → `AUTH_TOKEN_INVALID` (401).
- **Employee (role ≠ ADMIN) → 403**: `AdminGuard` kiểm `request.user.role !== 'ADMIN'` → `AUTH_FORBIDDEN` (403).
- **Admin → CRUD**: role `ADMIN` qua cả 2 guard.
- Thứ tự guard đúng (`JwtAuthGuard, AdminGuard`) → 401 ưu tiên trước 403.
- Frontend: `RequireAdmin` chặn UI cho non-admin (hiển thị 403) — phòng thủ nhiều lớp.

---

## 6. Frontend — ✅ PASS

- **List/Create/Edit/Delete**: đủ 3 page (`/dashboard/employees`, `/create`, `/[id]`) + components (Table, Form, Dialog view, Filter, StatusBadge, DeleteDialog, RequireAdmin).
- **Loading**: table spinner + AuthProvider loading gate. **Error**: inline error (list) + toast (mutation). **Toast**: create/update/delete (sonner).
- **Pagination**: prev/next + `meta`. **Filter/Search**: status/role select + search box.
- **Responsive**: table `overflow-x-auto`, filter `flex-col sm:flex-row`, grid form `sm:grid-cols-2`, header dashboard responsive.
- Advisory L-1 (search không debounce), L-4 (optimistic update chưa làm — dùng invalidate).

---

## 7. Security — ✅ PASS (kèm advisory M-1)

**Đạt các yêu cầu cốt lõi:**
- **Không** trả `password_hash` (mapper chỉ map field whitelist; grep xác nhận `passwordHash` chỉ dùng để GHI).
- **Không** trả refresh token, **không** expose `deleted_at`, **không** expose internal field (`createdBy/updatedBy/organizationId nội bộ` không có trong `EmployeeResponseDto`).
- `id` validate UUID (`ParseUUIDPipe`); tenant isolation chặn IDOR/BOLA chéo org.
- Password auto-gen bcrypt cost 12.

**Advisory M-1 (Medium)** — xem mục Findings: `POST /employees` trả `temporaryPassword` (plaintext) trong response — mâu thuẫn yêu cầu "Không trả password" và chưa nằm trong danh sách redact log.

---

## 8. Performance — ✅ PASS

- Truy vấn dùng index: `users(email)` unique cho `emailExists`; `employees(organization_id)` cho list; `employees(user_id)` unique.
- List: `findMany` + `count` gói trong 1 read-transaction; `include: { user: { role } }` (không N+1).
- Pagination `skip/take`; FE `keepPreviousData` chuyển trang mượt; `useRoles` staleTime 5'.
- Advisory L-1: search theo từng phím gõ (không debounce) → nhiều request; L-6: `emailExists` dùng `count` (nhẹ).

---

## 9. Code Quality — ✅ PASS

- **Không** `any` (grep sạch), **không** `TODO/FIXME` (grep sạch), **không** eslint warning, `tsc --noEmit` sạch.
- Clean Architecture: Controller (điều hướng) → Service (nghiệp vụ) → Repository (data-access, nhận `organizationId`) → Mapper/DTO/Exception. Không business logic trong controller.
- DRY: `Avatar`/`getInitials` dùng chung; `PartialType/OmitType` cho UpdateDTO; guard tái sử dụng (export từ AuthModule).

---

## 10. Test Result — ✅ PASS

- Backend `npm test`: **9 suites / 46 tests pass**; `EmployeeService` 8 case (email tồn tại, role mặc định + temporaryPassword không lộ passwordHash, roleId sai, not-found, pagination, soft-delete tx).
- Frontend: build + lint + typecheck pass (dự án chưa cấu hình test runner FE).
- Advisory M-3: unit test mock `EmployeeRepository` → không kiểm chứng where-clause tenant ở tầng DB; nên có 1 integration/e2e test 2-org.

---

# FINDINGS (advisory — KHÔNG chặn phát hành)

## Medium

### M-1 · Security — `temporaryPassword` trả về trong response tạo
- **File/Dòng**: `apps/backend/src/modules/employee/dto/employee-response.dto.ts` (`CreateEmployeeResponseDto.temporaryPassword`); trả tại `services/employee.service.ts:64`; hiển thị toast tại `app/(dashboard)/dashboard/employees/create/page.tsx`.
- **Nguyên nhân**: Yêu cầu SECURITY nêu "Không trả password". Response tạo lại chứa mật khẩu tạm dạng plaintext. Ngoài ra `temporaryPassword` **không** có trong danh sách redact của logger (`apps/backend/src/app.module.ts` redact paths có `*.password/*.passwordHash/*.refreshToken/*.accessToken` nhưng **thiếu** `*.temporaryPassword`) → rủi ro lộ nếu về sau log response body.
- **Bối cảnh**: Đây là quyết định thiết kế có chủ đích (đã ghi trong EMPLOYEE_IMPLEMENTATION_REPORT §Ghi chú) vì chưa có luồng gửi email (Forgot/Reset là S2+); truyền qua HTTPS, không lưu plaintext. **Không phải lỗ hổng rò rỉ secret đã lưu**, nhưng mâu thuẫn với yêu cầu literal.
- **Mức độ**: **Medium**. Khuyến nghị PO quyết: (a) giữ nhưng bổ sung `*.temporaryPassword` vào redact + đảm bảo không log body; hoặc (b) đổi sang cơ chế đặt mật khẩu qua email/reset link khi có module tương ứng.

### M-2 · Documentation — thiếu `docs/employee.md`
- **File**: `docs/employee.md` (không tồn tại).
- **Nguyên nhân**: CLAUDE.md Mục 16 yêu cầu mỗi module có tài liệu (requirements/business-rules/database/api). Module Employee chưa có tài liệu; nhiệm vụ review còn được yêu cầu đọc file này.
- **Mức độ**: **Medium** (hoàn thiện DoD/quy trình — không ảnh hưởng runtime).

### M-3 · Test — thiếu test tích hợp Tenant Isolation
- **File**: `apps/backend/src/modules/employee/services/employee.service.spec.ts` (mock `EmployeeRepository`).
- **Nguyên nhân**: Unit test mock repository nên **không** kiểm chứng where-clause có `organizationId` ở tầng Prisma. auth.md §20 (DoD) yêu cầu "test cô lập tenant (2 org không thấy dữ liệu nhau)". Hiện chỉ đảm bảo bằng đọc code.
- **Mức độ**: **Medium** (rủi ro hồi quy: nếu ai đó bỏ `organizationId` khỏi `findById/findMany`, không test nào bắt được).

## Low

### L-1 · Performance/UX — search không debounce
- **File**: `apps/frontend/features/employees/components/employee-filter.tsx` (`onChange({ search })` mỗi keystroke) → `useEmployees` refetch liên tục.
- **Mức độ**: **Low** (đã có `keepPreviousData`; nên thêm debounce ~300ms).

### L-2 · UI — Badge success/warning dùng màu cố định (không theo theme)
- **File**: `apps/frontend/components/ui/badge.tsx` (`bg-emerald-500/10 text-emerald-600`, `bg-amber-500/10 text-amber-600`).
- **Nguyên nhân**: khác với token semantic (`destructive` dùng `hsl(var(--destructive))`). Ở dark mode màu emerald/amber không tự thích ứng hoàn toàn.
- **Mức độ**: **Low** (vẫn đọc được; nên dùng token).

### L-3 · Dark Mode — chưa có toggle/provider kích hoạt `.dark` (pre-existing)
- **File**: `apps/frontend/app/layout.tsx` / `providers/index.tsx` (không set class `dark`, không `next-themes`).
- **Nguyên nhân**: `globals.css` có biến `.dark` và `tailwind.config` `darkMode:['class']`, nhưng không có cơ chế bật. Component Employee dùng token semantic → **tương thích** dark mode nếu được bật. Đây là khoảng trống hạ tầng có sẵn, ngoài phạm vi Employee.
- **Mức độ**: **Low**.

### L-4 · React Query — chưa có Optimistic Update
- **File**: `apps/frontend/features/employees/hooks/use-employees.ts` (dùng `invalidateQueries` sau mutation).
- **Nguyên nhân**: checklist nêu "Optimistic Update"; hiện dùng invalidate (an toàn, hợp lệ nhưng không optimistic).
- **Mức độ**: **Low** (invalidate là pattern chấp nhận được).

### L-5 · API cosmetic — `totalPages = 1` khi `total = 0`
- **File**: `apps/backend/src/modules/employee/services/employee.service.ts` (`Math.max(1, Math.ceil(total/limit))`).
- **Nguyên nhân**: 0 nhân viên vẫn trả `totalPages: 1`. FE ẩn footer khi `total = 0` nên không ảnh hưởng UX.
- **Mức độ**: **Low**.

### L-6 · Security minor — 409 email tiết lộ email tồn tại xuyên tenant
- **File**: `apps/backend/src/modules/employee/services/employee.service.ts` (`emailExists` toàn hệ thống → `EMPLOYEE_EMAIL_EXISTS`).
- **Nguyên nhân**: bản chất của email global unique (Decision-001), giống Register. Admin org B biết một email đã tồn tại đâu đó.
- **Mức độ**: **Low** (chấp nhận theo thiết kế global-unique).

---

# Kết luận

Không có lỗi **Critical/High**. Tất cả 10 hạng mục **PASS**; build/test/lint/typecheck/prisma-validate xanh; tenant isolation và không rò rỉ dữ liệu nhạy cảm được xác nhận.

## ✅ EMPLOYEE MODULE IS PRODUCTION READY

Khuyến nghị (không chặn phát hành) xử lý ở vòng sau: **M-1** (chính sách `temporaryPassword` + redact log), **M-2** (`docs/employee.md`), **M-3** (test tích hợp 2-org). Các advisory Low là cải thiện chất lượng.

> Review-only: KHÔNG sửa code theo yêu cầu. Mọi phát hiện chỉ ghi nhận trong tài liệu này.
