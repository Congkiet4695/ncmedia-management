# Employee Module — Production Documentation

> Module: **Employee** (module nghiệp vụ đầu tiên) · Sprint 2
> Product: **NCMedia Management Platform** · Version 1.0 · Status: **✅ IMPLEMENTED**
> Nguồn: `.claude/CLAUDE.md`, `architecture/ADR.md` (ADR-003/004/005/007/009/015), `docs/database.md`, `docs/auth.md`.
> Bổ sung theo Finding M-2 (EMPLOYEE_FINAL_REVIEW.md). Đồng bộ với code hiện tại (`apps/backend/src/modules/employee`, `apps/frontend/features/employees`).

---

## 1. Mục tiêu & Phạm vi

Cho phép **Admin** quản lý nhân viên (Employee) trong Organization của mình: tạo, xem, sửa, xóa mềm. Đây là module nghiệp vụ đầu tiên đặt nền cho các module sau (Shop, Order…).

- **Trong phạm vi:** CRUD Employee, filter/search/sort/pagination, tenant isolation, admin-only.
- **Ngoài phạm vi:** Platform, Shop, Order, Report; đổi mật khẩu/gửi email cho nhân viên (Forgot/Reset — S2+); RBAC permission đầy đủ.

---

## 2. Mô hình dữ liệu (ADR-007)

`Organization → User → Employee`. **User** giữ auth (email, password, status, role); **Employee** giữ hồ sơ nghiệp vụ. `fullName/email/status/role` là của **User** (nguồn duy nhất — không lặp).

### Bảng `employees` (tenant-scoped, soft delete — ADR-015)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK → organizations.id (Restrict), NOT NULL |
| user_id | uuid | FK → users.id (Restrict), **UNIQUE** (1-1) |
| date_of_birth | date | NULL |
| salary | decimal(15,2) | NOT NULL default 0, CHECK `>= 0` |
| avatar | varchar(1024) | NULL |
| created_at / updated_at / deleted_at | timestamptz | audit |
| created_by / updated_by | uuid | NULL |

- Index: `employees_user_id_key` (unique), `employees_organization_id_idx`.
- Migration: `prisma/migrations/20260715000000_add_employee/migration.sql`.
- Role của Employee = `users.role_id` (một User một Role — Decision-007).

---

## 3. Business Rules

| BR | Nội dung |
|---|---|
| BR-E01 | Admin tạo/sửa/xóa Employee **trong Organization của mình** (tenant isolation — ADR-004). |
| BR-E02 | Employee thuộc **đúng 1 Organization**; `organization_id` luôn lấy từ Access Token, không nhận từ client. |
| BR-E03 | `email` **UNIQUE GLOBAL** (Decision-001); soft-deleted vẫn giữ chỗ email. |
| BR-E04 | Mật khẩu **auto-generate** (entropy cao) + **bcrypt cost 12** (Decision-003); không lưu plaintext. |
| BR-E05 | Role **chọn khi tạo**; bỏ trống → Role mặc định **EMPLOYEE**. roleId phải thuộc Organization. |
| BR-E06 | `status` mặc định **ACTIVE** (chỉ ACTIVE/INACTIVE/SUSPENDED; LOCKED là trạng thái bảo mật, không set qua UI). |
| BR-E07 | `salary` mặc định **0** (VND), **>= 0**. |
| BR-E08 | **Soft delete** (`deleted_at`), **không hard delete**; xóa Employee đồng thời vô hiệu tài khoản User (chặn login). |
| BR-E09 | Admin **không** đổi Organization của Employee (không có field `organizationId` trong DTO). |
| BR-E10 | Chỉ **ADMIN** truy cập module (JwtAuthGuard + AdminGuard); role khác → 403. |

> **Mật khẩu tạm (temporaryPassword):** trả **một lần** trong response tạo để Admin bàn giao (chưa có luồng email). Được redact trong log (`*.temporaryPassword`). Không xuất hiện ở GET/LIST/PATCH.

---

## 4. API

Base `/api/v1`. Header `Authorization: Bearer <access>`. Guard: **JwtAuthGuard + AdminGuard**. Envelope chuẩn + `errors[]` (ADR-022).

| Method & Path | Auth | Mô tả | Success |
|---|---|---|---|
| `POST /employees` | Admin | Tạo Employee | `201` `{ …employee, temporaryPassword }` |
| `GET /employees` | Admin | Danh sách (filter/search/sort/pagination) | `200` `{ items, meta }` |
| `GET /employees/:id` | Admin | Chi tiết | `200` employee |
| `PATCH /employees/:id` | Admin | Cập nhật | `200` employee |
| `DELETE /employees/:id` | Admin | Xóa mềm | `200` `data: null` |
| `GET /roles` | Admin | Danh sách Role (selector) | `200` `RoleResponseDto[]` |

### 4.1. Query danh sách (`GET /employees`)
`page` (≥1, default 1), `limit` (1–100, default 20), `fullname`, `email`, `status`, `roleId`, `search` (OR fullname/email), `sortBy` (`createdAt|fullName|email|salary|status`), `sortOrder` (`asc|desc`). `meta: { total, page, limit, totalPages }` (ADR-023; `totalPages = 0` khi `total = 0`).

### 4.2. Response Employee
```json
{
  "id": "...", "fullName": "...", "email": "...", "avatar": null,
  "dateOfBirth": "1990-01-15", "salary": 0, "status": "ACTIVE",
  "role": { "id": "...", "code": "EMPLOYEE", "name": "Employee" },
  "createdAt": "...", "updatedAt": "..."
}
```
**Không** trả: `passwordHash`, `refreshToken`, `deleted_at`, `created_by/updated_by`, permissions.

### 4.3. Error codes
`EMPLOYEE_EMAIL_EXISTS` (409), `EMPLOYEE_NOT_FOUND` (404), `EMPLOYEE_ROLE_INVALID` (400), `VALIDATION_ERROR` (400), `AUTH_TOKEN_INVALID` (401), `AUTH_FORBIDDEN` (403).

---

## 5. Validation (DTO — class-validator; FE — Zod)

| Field | Rule |
|---|---|
| fullName | required, 2–255, trim |
| email | required, email hợp lệ, ≤255, lowercase (chỉ khi tạo; edit không đổi) |
| salary | number, `>= 0`, ≤ 9,999,999,999,999 (khớp DECIMAL(15,2)) |
| dateOfBirth | ISO date (`YYYY-MM-DD`), optional |
| status | ∈ {ACTIVE, INACTIVE, SUSPENDED}, default ACTIVE |
| roleId | UUID, optional (default EMPLOYEE) |
| avatar | string ≤ 1024, optional |
| :id | UUID (`ParseUUIDPipe`) |

---

## 6. Transaction (nguyên tử)

**Create:** `check email unique → resolve Role → bcrypt hash → $transaction( create User → create Employee ) → commit`. Lỗi bất kỳ → rollback; P2002(email) → `EMPLOYEE_EMAIL_EXISTS`.
**Update:** `findById(org,id) → (nếu có roleId) verify role thuộc org → $transaction( update User? + update Employee )`.
**Delete:** `findById(org,id) → $transaction( soft-delete Employee + soft-delete User )`.

---

## 7. Tenant Isolation (ADR-004)

Mọi truy vấn ở Repository nhận `organizationId`:
- `findById/findMany`: `where { organizationId, deletedAt: null, … }`.
- `update/delete`: `findById(organizationId, id)` trước → khác tenant = `404` (không sửa/xóa được).
- `create`: `organizationId` từ token.

Kết quả: Admin org A **không** thấy/sửa/xóa Employee của org B.

---

## 8. Frontend

- Pages: `/dashboard/employees` (list), `/dashboard/employees/create`, `/dashboard/employees/[id]` (edit).
- Components: `EmployeeTable`, `EmployeeForm`, `EmployeeDialog` (view), `EmployeeFilter`, `EmployeeStatusBadge`, `DeleteDialog`, `RequireAdmin`.
- React Query: `useEmployees`, `useEmployee`, `useRoles`, `useCreateEmployee`, `useUpdateEmployee`, `useDeleteEmployee` (delete có **optimistic update** + rollback, invalidate `['employees']`).
- Auth: AuthProvider + Access Token + GET /me; `RequireAdmin` chặn non-admin (403). Search **debounce** 350ms.
- UI: shadcn/ui (Table/Badge/Avatar/NativeSelect/Modal), responsive, hỗ trợ dark mode (theme toggle).

---

## 9. Acceptance Criteria

- [x] CRUD Employee đúng tenant; Admin A không thấy Employee B.
- [x] Email global unique; role/status/salary mặc định đúng; password auto-gen bcrypt 12.
- [x] Soft delete (Employee + User), không hard delete.
- [x] Validation + Swagger + error envelope `errors[]`.
- [x] Chỉ ADMIN truy cập (Guest 401, Employee 403).
- [x] Không lộ passwordHash/refresh token/internal fields.
- [x] Build/Test/Lint/Typecheck xanh.
