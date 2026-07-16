# EMPLOYEE — Update Report (HR fields theo sheet "Nhân viên")

> Module: **Employee** · Product: **NCMedia Management Platform** · Ngày: 2026-07-15
> Mở rộng module Employee hiện tại theo nghiệp vụ thực tế. KHÔNG tạo module mới, KHÔNG đổi kiến trúc.
> KHÔNG thay đổi: Authentication, Permission, Tenant Isolation, Role, JWT, Redis.

---

## Quyết định thiết kế chính

**Trạng thái** mới có giá trị **RESIGNED** (không có trong `UserStatus` của auth). Để **không đụng Authentication**, thêm enum **`EmployeeStatus` {ACTIVE, INACTIVE, RESIGNED, SUSPENDED}** riêng trên bảng `employees`; `UserStatus` (auth) giữ nguyên. Service **đồng bộ** `User.status` từ `Employee.status` để login nhất quán: `ACTIVE→ACTIVE, INACTIVE→INACTIVE, SUSPENDED→SUSPENDED, RESIGNED→INACTIVE` (chặn đăng nhập). `fullName/email/role` vẫn ở `User` (nguồn duy nhất — không lặp).

---

## 1. Database thay đổi

**Enum mới:** `employee_status` = `ACTIVE | INACTIVE | RESIGNED | SUSPENDED`.

**Bảng `employees` — cột thêm** (tất cả nullable trừ `status`):

| Cột | Kiểu | Ghi chú |
|---|---|---|
| status | employee_status | NOT NULL default ACTIVE (backfill từ users.status) |
| lark_account | varchar(255) | Account Lark |
| start_date | date | Ngày bắt đầu làm việc |
| resigned_at | date | Ngày nghỉ việc |
| cccd | varchar(20) | **UNIQUE** (cho phép nhiều NULL) |
| cccd_image_url | varchar(1024) | URL ảnh CCCD |
| phone | varchar(20) | Số điện thoại |
| address | varchar(500) | Địa chỉ |
| department | varchar(255) | Phòng làm việc |
| bank_account | varchar(100) | Tài khoản ngân hàng |
| bank_qr_url | varchar(1024) | URL QR ngân hàng |

> Giữ nguyên: `date_of_birth`, `salary`, `avatar`, các cột audit.

**Index:** `employees_cccd_key` (UNIQUE), `employees_status_idx`, `employees_department_idx` (+ `employees_organization_id_idx` cũ).

**Migration:** `prisma/migrations/20260715010000_employee_hr_fields/migration.sql` — **additive, không mất dữ liệu**:
- `ALTER TABLE ADD COLUMN …` cho các cột mới.
- **Backfill** `status` từ `users.status` (`LOCKED → SUSPENDED`).
- Tạo unique index cho `cccd` + index `status`, `department`.

`npx prisma generate` đã chạy (client có enum `EmployeeStatus` + field mới). `prisma validate` OK.

---

## 2. DTO thay đổi

| DTO | Thay đổi |
|---|---|
| **CreateEmployeeDto** | Thêm `status` (EmployeeStatus), `larkAccount`, `startDate`, `resignedAt`, `cccd`, `cccdImageUrl`, `phone`, `address`, `department`, `bankAccount`, `bankQrUrl`. Giữ `fullName`(required), `email`, `dateOfBirth`, `salary`, `avatar`, `roleId`. Validation: `cccd` 9–12 số, `phone` regex, ngày ISO. |
| **UpdateEmployeeDto** | `PartialType(OmitType(CreateEmployeeDto, ['email']))` → **tự động kế thừa** toàn bộ field mới (optional). |
| **EmployeeResponseDto** | Bổ sung đầy đủ field mới (detail); `status` là EmployeeStatus. KHÔNG lộ passwordHash. |
| **EmployeeListItemDto** *(mới)* | Hàng bảng: `id, fullName, email, phone, department, status, startDate, resignedAt, avatar, role, createdAt`. `PaginatedEmployeeResponseDto.items` dùng DTO này. |
| **EmployeeQueryDto** | Thêm filter `department`, `startDate` (từ ngày); `status` → EmployeeStatus; `search` = tên/email/**SĐT**; sort thêm `startDate`. |

---

## 3. API thay đổi

- Endpoint **không đổi**: `POST/GET/GET:id/PATCH/DELETE /employees` + `GET /roles`.
- **Swagger cập nhật toàn bộ field mới** (qua `@ApiProperty` trên DTO).
- **List** trả `EmployeeListItemDto[]` (nhẹ, đúng cột bảng); **detail/create/update** trả `EmployeeResponseDto` đầy đủ.
- **Filter**: `fullname`, `email`, `status`, `department` (chứa), `startDate` (>=), `roleId`. **Search**: tên/email/SĐT.
- **Error code mới**: `EMPLOYEE_CCCD_EXISTS` (409) — CCCD trùng (kèm map P2002 email/cccd).
- Tenant isolation & guard giữ nguyên (JwtAuthGuard + AdminGuard, mọi query scoped `organizationId`).

---

## 4. Frontend thay đổi

| Khu vực | Thay đổi |
|---|---|
| **types / schema / service** | Thêm toàn bộ field mới; `EmployeeStatus` có `RESIGNED`; tách `Employee` (detail) và `EmployeeListItem` (list); Zod validate field mới (cccd, phone, dates). |
| **Employee List (table)** | Cột: **Avatar, Tên, Email, SĐT, Phòng, Trạng thái, Ngày vào làm, Ngày nghỉ, Action**. |
| **Filter** | Search (tên/email/SĐT, debounce) + Trạng thái + Phòng (debounce) + Vào làm từ ngày. |
| **Create / Edit Form** | Hiển thị **đầy đủ** field; Ảnh CCCD & QR Ngân hàng nhập **URL**. |
| **Detail dialog (View)** | Tự fetch hồ sơ đầy đủ theo id; hiển thị mọi field + link Ảnh CCCD / QR. |
| **Status badge** | Thêm `RESIGNED` (variant warning, thích ứng dark mode). |

Auth/Provider/RequireAdmin (ADMIN-only), React Query (cache/invalidate/optimistic delete), responsive, shadcn/ui — **giữ nguyên**.

---

## 5. File đã sửa

### Backend
- `prisma/schema.prisma` *(enum EmployeeStatus + cột + index)*
- `prisma/migrations/20260715010000_employee_hr_fields/migration.sql` *(mới)*
- `src/modules/employee/constants/employee.constants.ts`
- `src/modules/employee/dto/create-employee.dto.ts`
- `src/modules/employee/dto/employee-query.dto.ts`
- `src/modules/employee/dto/employee-response.dto.ts`
- `src/modules/employee/mappers/employee.mapper.ts`
- `src/modules/employee/repositories/employee.repository.ts`
- `src/modules/employee/services/employee.service.ts`
- `src/modules/employee/exceptions/employee-cccd-exists.exception.ts` *(mới)*
- `src/modules/employee/services/employee.service.spec.ts`
- `src/modules/employee/repositories/employee.repository.spec.ts`

> `update-employee.dto.ts` KHÔNG cần sửa (kế thừa qua PartialType/OmitType).

### Frontend
- `features/employees/types.ts`
- `features/employees/schemas/employee.schema.ts`
- `features/employees/services/employee.service.ts`
- `features/employees/utils/form-payload.ts`
- `features/employees/components/employee-status-badge.tsx`
- `features/employees/components/employee-table.tsx`
- `features/employees/components/employee-filter.tsx`
- `features/employees/components/employee-dialog.tsx`
- `features/employees/components/employee-form.tsx`
- `app/(dashboard)/dashboard/employees/page.tsx`
- `app/(dashboard)/dashboard/employees/[id]/page.tsx`

---

## 6. Build Result

**Backend** — `npm run build`: ✅ `nest build` không lỗi TypeScript.
**Frontend** — `npm run build`: ✅ Compiled successfully · **không warning**.
**Frontend** — `npm run lint`: ✅ No ESLint warnings or errors.
**Frontend** — `npm run typecheck`: ✅ `tsc --noEmit` exit 0.

---

## 7. Test Result

**Backend** — `npm test`:
```
Test Suites: 10 passed, 10 total
Tests:       21 todo, 30 passed, 51 total
```
- `EmployeeService` (8) + `EmployeeRepository` (5) cập nhật theo shape mới (EmployeeStatus, field mới) — **không hồi quy**; auth suites xanh.
- Frontend: kiểm chứng qua build + lint + typecheck (đều xanh).

---

> **Kết luận:** Module Employee đã mở rộng đủ 14 trường theo sheet "Nhân viên" (thêm 11 cột + enum trạng thái RESIGNED), migration không mất dữ liệu cũ, Swagger/DTO/Frontend đồng bộ. Không thay đổi Authentication / Permission / Tenant / Role / JWT / Redis. Build/Test/Lint/Typecheck xanh.
