# DATABASE CHANGELOG

> Product: **NCMedia Management Platform** · Module: **Auth (Sprint 1)**
> File ảnh hưởng: `prisma/schema.prisma`
> Reviewer: Principal Database Architect · Ngày: 2026-07-14
> Phạm vi: **chỉ cập nhật Database Design**. Không sinh migration/NestJS/DTO/API/Frontend. Không đổi Business Rule/ADR.

---

## [2026-07-14] — Auth schema revision 2 (RefreshToken + tinh chỉnh RBAC)

### Tổng quan
Cập nhật `schema.prisma` theo 6 nhóm yêu cầu của Product Owner, kèm rà soát relation/index/cascade/nullable/naming/best-practice.

---

### 1. Thêm model `RefreshToken` 🆕

**Đã thay đổi**
- Thêm model `RefreshToken` (`@@map("refresh_tokens")`) với: `id`, `user_id`, `token_hash` (UNIQUE), `expires_at`, `revoked_at`, `replaced_by_id`, `ip_address`, `user_agent`, `created_at`, `updated_at`.
- Quan hệ:
  - `user` → `User` (`onDelete: Cascade`).
  - `replacedBy`/`replaces` — **self-relation** `"TokenRotation"` qua `replaced_by_id` (`onDelete: SetNull`).
- Quan hệ ngược `refreshTokens RefreshToken[]` thêm vào `User`.
- Index: `@@unique([token_hash])`, `@@index([user_id])`, `@@index([expires_at])`, `@@index([replaced_by_id])`.

**Lý do**
- Hỗ trợ **Rotation** (chuỗi token qua `replaced_by_id`), **Reuse Detection** (tra `token_hash`, nếu `revoked_at != null` khi bị dùng lại → nghi lộ), **Logout Current Device** (revoke 1 bản ghi), **Logout All Devices** (revoke mọi bản ghi theo `user_id`), **Audit Security** (`ip_address`, `user_agent`, timestamps).
- `token_hash` UNIQUE: tra cứu nhanh + đảm bảo mỗi token một bản ghi.
- Chỉ lưu **hash**, không plain text (yêu cầu bảo mật).

**Ảnh hưởng**
- Thêm bảng mới, không phá vỡ bảng hiện có.

**⚠️ Điểm cần Product Owner/Architect xác nhận (mâu thuẫn tài liệu — KHÔNG tự sửa ADR):**
- **ADR-006** và `docs/auth.md` (BR-10, Mục 15.4) hiện quy định Refresh Token lưu **Redis**. Nay có thêm **bảng DB** cho refresh token. Hai nguồn cần được điều hòa: hoặc (a) DB là nguồn chính (bền vững, phục vụ audit/rotation) và Redis chỉ là cache tra cứu nhanh; hoặc (b) cập nhật ADR-006 cho khớp. **Chưa đụng ADR theo yêu cầu** — đề nghị review quyết định.
- `RefreshToken` **không** có `organization_id` (suy ra qua `user.organizationId`) và **không** soft delete (dùng `revoked_at` thay cho `deleted_at` — đúng ngữ nghĩa session). Điều này lệch với quy ước "bảng nghiệp vụ có organization_id + deleted_at" ở CLAUDE.md Mục 11; xử lý nhất quán với tinh thần "tránh dư thừa" ở mục #5. Đề nghị xác nhận.

---

### 2. Employee Preparation (không implement) 🧩

**Đã thay đổi**
- Thêm **TODO comment** rõ ràng trong model `User` chỉ vị trí khai báo quan hệ `User ↔ Employee` (1-1 theo ADR-007) khi Sprint sau bổ sung model `Employee`.

**Lý do**
- Chuẩn bị khả năng mở rộng mà **không** implement Employee trong Sprint 1 (đúng phạm vi).
- Chọn phương án TODO thay vì khai báo relation thật, vì Prisma yêu cầu model đích tồn tại — khai báo relation tới `Employee` chưa có sẽ làm schema không validate.

**Ảnh hưởng**
- Không thay đổi cấu trúc bảng. Không breaking.

---

### 3. `Role.description` ➕

**Đã thay đổi**
- Thêm `description String? @db.VarChar(255)` vào model `Role`.

**Lý do**
- Mô tả Role (yêu cầu PO #3).

**Ảnh hưởng**
- Cột nullable → **không breaking**, không cần backfill.

---

### 4. `Permission.module` ➕

**Đã thay đổi**
- Thêm `module String @db.VarChar(50)` (NOT NULL) vào model `Permission`.
- Thêm `@@index([module])`.

**Lý do**
- Nhóm permission theo module (AUTH, EMPLOYEE, ORDER, REPORT, SHOP, PLATFORM...) — lưu **tường minh**, KHÔNG parse từ `resource` (yêu cầu PO #4).

**Ảnh hưởng**
- Cột **NOT NULL** không default → nếu đã có dữ liệu `permissions` sẽ cần backfill khi migrate. Hiện **chưa có migration/dữ liệu** nên không ảnh hưởng thực tế. Seeder phải set `module` cho mọi permission.
- **Breaking ở tầng dữ liệu seed** (bắt buộc cung cấp `module`).

---

### 5. Bỏ `RolePermission.organization_id` ➖

**Đã thay đổi**
- Xóa cột `organization_id`, quan hệ `organization`, và `@@index([organization_id])` khỏi `RolePermission`.
- Xóa quan hệ ngược `rolePermissions` khỏi model `Organization`.

**Lý do**
- `Role` đã thuộc `Organization`; `RolePermission` liên kết `role_id` → tenant suy ra được. Tránh dư thừa dữ liệu (yêu cầu PO #5).

**Ảnh hưởng**
- Truy vấn theo tenant trên `RolePermission` phải **join qua `Role`** thay vì lọc trực tiếp `organization_id`.
- **Breaking về cấu trúc** (đổi cột). Chưa có migration nên chưa ảnh hưởng runtime.

---

### 6. Database Review — rà soát & sửa 🔍

**Relation**
- Toàn bộ FK có quan hệ 2 chiều hợp lệ. Self-relation `TokenRotation` khai báo đúng (một chiều `replacedBy` + mảng ngược `replaces`).

**Index — tối ưu, loại bỏ dư thừa:**
- ✅ Bỏ `@@index([organizationId])` ở `Role` — đã được bao bởi UNIQUE `(organization_id, code)` (index tiền tố trái).
- ✅ Bỏ `@@index([roleId])` ở `RolePermission` — đã được bao bởi UNIQUE `(role_id, permission_id)`; giữ `@@index([permissionId])` (không nằm ở tiền tố trái).
- ✅ Giữ `@@index([organizationId])`, `@@index([roleId])` ở `User` (không có unique tổ hợp phủ).
- ✅ `RefreshToken`: `token_hash` UNIQUE (đủ cho tra cứu, bỏ index trùng); thêm index `user_id`, `expires_at` (dọn token hết hạn), `replaced_by_id`.

**Cascade Rule**
- `User.organization`, `User.role`, `Role.organization`, `RolePermission.permission`: `onDelete: Restrict` — chặn xóa cứng đối tượng đang được tham chiếu (nhất quán với chiến lược soft delete).
- `RolePermission.role`: `onDelete: Cascade` — xóa Role kéo theo gỡ gán quyền.
- `RefreshToken.user`: `onDelete: Cascade` — dọn phiên khi user bị xóa cứng.
- `RefreshToken.replacedBy`: `onDelete: SetNull` — không đứt chuỗi khi token thay thế bị dọn.

**Nullable**
- `revoked_at`, `replaced_by_id`, `ip_address`, `user_agent` nullable (đúng ngữ nghĩa). `expires_at`, `token_hash` NOT NULL.
- `Role.description` nullable; `Permission.module` NOT NULL (bắt buộc phân nhóm).

**Naming Convention**
- Model PascalCase; field camelCase `@map` sang snake_case; bảng snake_case số nhiều `@@map`; enum `@@map` snake_case. Nhất quán toàn schema.

**Prisma Best Practice**
- UUID `@db.Uuid`, `@default(uuid())`; thời gian `@db.Timestamptz(6)` đồng nhất; `@updatedAt` cho `updated_at`; self-relation đặt tên; extension `citext` khai báo trong datasource; index trên mọi FK phục vụ join.

---

## Tổng hợp Breaking Change

| # | Thay đổi | Loại | Breaking? |
|---|---|---|---|
| 1 | Thêm `RefreshToken` | Thêm bảng | Không (mới) — nhưng cần điều hòa với ADR-006 (Redis) |
| 2 | TODO Employee | Comment | Không |
| 3 | `Role.description` | Thêm cột nullable | Không |
| 4 | `Permission.module` | Thêm cột NOT NULL | Có (seed bắt buộc `module`) |
| 5 | Bỏ `RolePermission.organization_id` | Xóa cột | Có (đổi cấu trúc + cách query tenant) |
| 6 | Tối ưu index / cascade | Tinh chỉnh | Không |

> **Kết luận:** Vì **chưa có migration và chưa có dữ liệu**, các breaking change (#4, #5) hiện **không** ảnh hưởng runtime — chỉ ràng buộc cho bước migration/seed sau này.

---

## Việc cần review trước khi sang bước Migration

1. **Điều hòa Refresh Token (DB vs Redis)** — quyết định nguồn chính; nếu chọn DB thì cần cập nhật ADR-006 & `docs/auth.md` (ngoài phạm vi vòng này).
2. Xác nhận `RefreshToken` **không** cần `organization_id`/soft delete (nhất quán ngoại lệ như #5).
3. Seeder phải cung cấp `module` cho mọi permission catalog.

> Dừng lại chờ review theo yêu cầu. Không sinh migration/NestJS/DTO/API/Frontend.
