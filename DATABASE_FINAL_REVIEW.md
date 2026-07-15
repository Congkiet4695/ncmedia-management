# DATABASE FINAL REVIEW — Auth Module (Sprint 1)

> Product: **NCMedia Management Platform** · Reviewer: **Principal Database Architect**
> Ngày: 2026-07-14 · File: `prisma/schema.prisma` · ADR liên quan: ADR-003/004/005/006(rev)/010/011/015
> Phạm vi: chỉ review Database Design. Không sinh migration/NestJS/DTO/API/Frontend.

---

## 0. Quyết định vòng này đã áp dụng

| # | Quyết định PO | Trạng thái |
|---|---|---|
| 1 | Database là Source of Truth cho Refresh Token | ✅ ADR-006 (rev) + bảng `refresh_tokens` |
| 2 | Redis chỉ là Cache | ✅ ADR-006 (rev) |
| 3 | Cập nhật ADR-006 | ✅ Đã revise + ghi Revision note |
| 4 | RefreshToken KHÔNG có `organization_id` | ✅ Không có (suy ra qua `user`) |
| 5 | RefreshToken KHÔNG có `deleted_at` | ✅ Không có |
| 6 | `revoked_at` là đủ | ✅ Dùng `revoked_at` |
| 7 | `Permission.module` NOT NULL | ✅ NOT NULL |
| 8 | Seeder phải sinh `module` | ✅ Ghi nhận (thực thi ở bước seed) |
| 9 | `token_hash` dùng HMAC-SHA256 | ✅ Comment schema + ADR-006 |
| 10 | `user_agent` giới hạn hợp lý / chuẩn bị parser | ✅ VarChar(512), ghi chú parse ở tầng app |

---

## 1. Entity Design ✅

6 model, 2 enum. Tất cả PK là UUID (`@default(uuid())`), không auto-increment (ADR-005).

| Entity | Loại | organization_id | Soft delete | Audit đầy đủ |
|---|---|---|---|---|
| `Organization` | Tenant root | — | ✅ deleted_at | ✅ |
| `User` | Tenant-scoped | ✅ | ✅ | ✅ |
| `RefreshToken` | Session (thuộc User) | ❌ (chủ ý) | ❌ dùng `revoked_at` | created/updated_at |
| `Role` | Tenant-scoped | ✅ | ✅ | ✅ |
| `Permission` | Global catalog | ❌ (chủ ý) | ❌ | created/updated_at |
| `RolePermission` | Gán quyền (thuộc Role) | ❌ (bỏ, chủ ý) | ✅ | ✅ |

Enum: `UserStatus{ACTIVE,INACTIVE,LOCKED,SUSPENDED}`, `OrganizationStatus{ACTIVE,TRIAL,SUSPENDED,DELETED}`.

**Kết luận:** thiết kế nhất quán với quyết định; các ngoại lệ về `organization_id`/soft-delete đều có chủ đích và được ghi rõ.

---

## 2. Relationship ✅

| Quan hệ | Bội số | Khai báo |
|---|---|---|
| Organization → User | 1—N | OK (2 chiều) |
| Organization → Role | 1—N | OK |
| Role → User | 1—N (mỗi User đúng 1 Role) | OK (Decision-007) |
| Role → RolePermission | 1—N | OK |
| Permission → RolePermission | 1—N | OK |
| User → RefreshToken | 1—N | OK |
| RefreshToken → RefreshToken | self (`TokenRotation`) | OK (`replacedBy`/`replaces`) |

- Mọi FK có quan hệ ngược hợp lệ; không có quan hệ mồ côi.
- Self-relation rotation cho phép truy vết chuỗi token (reuse detection).
- `RolePermission` không còn quan hệ tới `Organization` (đã bỏ) — tenant suy ra qua `Role`.

---

## 3. Index ✅

| Bảng | Index | Ghi chú |
|---|---|---|
| organizations | `slug` UNIQUE | |
| users | `email` UNIQUE (global) | |
| users | `organization_id`, `role_id` | join theo tenant/role |
| refresh_tokens | `token_hash` UNIQUE | tra cứu reuse detection |
| refresh_tokens | `user_id` | logout-all / liệt kê phiên |
| refresh_tokens | `expires_at` | dọn token hết hạn |
| refresh_tokens | `replaced_by_id` | truy vết chuỗi rotation |
| roles | `(organization_id, code)` UNIQUE | phủ tiền tố `organization_id` |
| permissions | `code` UNIQUE, `module`, `resource` | lọc theo module/resource |
| role_permissions | `(role_id, permission_id)` UNIQUE | phủ tiền tố `role_id` |
| role_permissions | `permission_id` | chiều tra ngược |

- **Không có index dư thừa**: đã bỏ `@@index([organization_id])` ở `Role` và `@@index([role_id])` ở `RolePermission` vì đã được UNIQUE tổ hợp (tiền tố trái) phủ.

---

## 4. Constraint ✅

- **Unique:** `organizations.slug`; `users.email` (global vĩnh viễn, không partial); `permissions.code`; `roles(organization_id, code)`; `role_permissions(role_id, permission_id)`; `refresh_tokens.token_hash`.
- **NOT NULL trọng yếu:** `permissions.module`, `users.role_id`, `users.email`, `refresh_tokens.token_hash`, `refresh_tokens.expires_at`.
- **Nullable đúng ngữ nghĩa:** `role.description`, `refresh_tokens.revoked_at/replaced_by_id/ip_address/user_agent`, các cột audit `*_by`, `deleted_at`.
- **Chờ bước Migration (Prisma không biểu diễn):** CHECK regex `slug ~ '^[a-z0-9-]+$'`; `CREATE EXTENSION citext`; (tùy chọn) CHECK `failed_login_count >= 0`.

---

## 5. Cascade Rule ✅

| FK | onDelete | Lý do |
|---|---|---|
| User → Organization | Restrict | Không xóa cứng org đang có user (soft delete) |
| User → Role | Restrict | Không xóa role đang được gán |
| Role → Organization | Restrict | |
| RolePermission → Role | Cascade | Xóa role gỡ luôn gán quyền |
| RolePermission → Permission | Restrict | Không xóa permission đang được gán |
| RefreshToken → User | Cascade | Dọn phiên khi user bị xóa cứng |
| RefreshToken → RefreshToken (replacedBy) | SetNull | Không đứt chuỗi khi token thay thế bị dọn |

Nhất quán với chiến lược soft delete: đối tượng "sống" được `Restrict`, dữ liệu phụ thuộc vòng đời ngắn được `Cascade`/`SetNull`.

---

## 6. Security ✅

- **Refresh token:** chỉ lưu **hash HMAC-SHA256**, không plain text; `token_hash` UNIQUE phục vụ **reuse detection**; rotation qua `replaced_by_id`; thu hồi qua `revoked_at` (logout current/all). Audit: `ip_address`, `user_agent`, timestamps.
- **Password:** bcrypt (cost 12) — `password_hash`, không plain text.
- **Email:** `citext` unique global.
- **Tenant isolation:** enforce ở tầng Backend (ADR-004); DB giữ FK. `RefreshToken`/`RolePermission` suy tenant qua quan hệ, không lộ thêm cột.
- **PII:** chính sách mask log (Decision-018) — tầng ứng dụng.
- **Secrets:** khóa HMAC & JWT (HS256) lưu ENV/secret manager, không hardcode (ADR-020/021).

---

## 7. Performance ✅

- Index phủ các đường truy vấn chính: login (`users.email`), phân giải quyền (`role_permissions` theo `role_id`), phiên (`refresh_tokens.user_id`), dọn rác (`refresh_tokens.expires_at`).
- Không index thừa (giảm chi phí ghi).
- `timestamptz(6)` đồng nhất; kiểu chuỗi giới hạn độ dài hợp lý (VarChar) tránh phình.
- Bỏ `organization_id` ở `RolePermission` giảm 1 cột + 1 index trên bảng gán quyền (bảng có thể lớn) → ghi/đọc nhẹ hơn.
- Khuyến nghị vận hành (không chặn): job định kỳ dọn `refresh_tokens` đã `expires_at`/`revoked_at` để giữ bảng gọn.

---

## 8. Kết luận

- Toàn bộ 10 quyết định vòng này đã phản ánh vào `schema.prisma` và ADR-006 (revised).
- Entity / Relationship / Index / Constraint / Cascade / Security / Performance: **không còn vấn đề tồn đọng**.
- Không còn mâu thuẫn giữa schema và ADR (Refresh Token DB-source-of-truth đã được ADR-006 xác nhận).

# ✅ APPROVED FOR MIGRATION

> Ghi chú cho bước Migration (không chặn phê duyệt): thêm CHECK regex slug + extension `citext`; seeder bắt buộc sinh `permissions.module`.
>
> Không sinh migration / NestJS / Prisma mới theo phạm vi hiện tại. Dừng chờ triển khai Migration khi có yêu cầu.
