# AUTH — Final Review

> Module: **Authentication & RBAC Foundation** · Sprint 1
> Ngày: 2026-07-14 · Reviewer: Technical Architect
> Kết luận: **✅ SẴN SÀNG THIẾT KẾ DATABASE**

---

## 1. Mục đích

Xác nhận rằng module Auth đã có đầy đủ quyết định và đặc tả để chuyển sang **bước Database** (thiết kế schema + migration) theo workflow ADR-019:

`Requirement → Business Rule → Database → API → Backend → Frontend → Review → Merge`

Hiện đã hoàn tất: **Requirement + Business Rule + Database design (tài liệu) + API design**. Bước tiếp theo là hiện thực Database.

---

## 2. Tài liệu liên quan

| File | Vai trò | Trạng thái |
|---|---|---|
| `docs/auth.md` (v2.0) | Đặc tả module Auth (20 mục) | ✅ ACCEPTED |
| `docs/auth-decisions.md` | 18 quyết định | ✅ Toàn bộ ACCEPTED |
| `architecture/ADR.md` | Bổ sung ADR-021 → 024 | ✅ ACCEPTED |
| `.claude/CLAUDE.md` | Source of Truth | ⚠️ Xem Mục 6 (đề xuất đồng bộ Mục 12) |

---

## 3. Xác nhận 18 Decision đã áp dụng

| # | Quyết định PO | Đã phản ánh trong auth.md |
|---|---|---|
| 1 | Email global unique | ✅ BR-04, users.email UNIQUE global |
| 2 | Password ≥ 8, có chữ + số | ✅ BR-07, Mục 17 |
| 3 | bcrypt cost = 12 | ✅ BR-06, Mục 19 |
| 4 | Sai 5 lần → khóa 15' (email+IP) | ✅ BR-14, Flow 7, cột `failed_login_count`/`locked_until` |
| 5 | Rate limit 5/3/30 | ✅ Mục 19, Flow 7/8/11 |
| 6 | Rotation + Reuse Detection | ✅ BR-11, Flow 8 |
| 7 | Một User một Role | ✅ BR-19, `users.role_id`, bỏ bảng `user_roles` |
| 8 | Permission Global | ✅ BR-22, 15.1 |
| 9 | JWT HS256 | ✅ BR-12, Mục 19, ADR-021 |
| 10 | Verify Email → Sprint 2 | ✅ Mục 2/13 |
| 11 | Verify TTL 24h | ✅ 15.4 |
| 12 | Reset TTL 30' | ✅ 15.4 |
| 13 | Response có `errors[]` | ✅ Mục 16/18, ADR-022 |
| 14 | Pagination page/limit | ✅ Mục 16, ADR-023 |
| 15 | Đổi mật khẩu giữ phiên hiện tại | ✅ Flow 10, BR-08 |
| 16 | Organization slug unique | ✅ BR-23, 15.2 |
| 17 | User mặc định ACTIVE | ✅ BR-13, Flow 6 |
| 18 | Sprint 1 chỉ mask PII | ✅ BR-24, Mục 19, ADR-024 |

**Kết quả:** 18/18 ACCEPTED, không còn mục `[Giả định]` / OPEN / PENDING trong `docs/auth.md`.

---

## 4. Checklist sẵn sàng Database

- [x] Danh sách bảng chốt: `organizations`, `users`, `roles`, `permissions`, `role_permissions`.
- [x] Bỏ bảng `user_roles` (do một User một Role).
- [x] Khóa ngoại rõ ràng: `users.organization_id`, `users.role_id`, `role_permissions.role_id/permission_id`.
- [x] Phân loại tenant-scoped vs Global (`permissions` là Global — không `organization_id`).
- [x] Cột audit + soft delete cho mọi bảng nghiệp vụ (ADR-015).
- [x] UUID PK, không auto-increment (ADR-005).
- [x] Ràng buộc unique: `users.email` (global), `organizations.slug`, `roles(organization_id, code)`, `role_permissions(role_id, permission_id)`.
- [x] Cột phục vụ nghiệp vụ auth: `status`, `email_verified_at`, `password_changed_at`, `last_login_at`, `failed_login_count`, `locked_until`.
- [x] Cấu trúc Redis (refresh/reset/verify/login-fail) + TTL rõ ràng.
- [x] Kế hoạch seed (permission catalog + 3 role + gán quyền admin).
- [x] Chỉ mục đề xuất.

---

## 5. Rủi ro / Lưu ý khi hiện thực Database

1. **`email citext` + UNIQUE global:** dùng `@db.Citext` (bật extension `citext`) để so sánh không phân biệt hoa/thường. **[ĐÃ CHỐT bổ sung]** UNIQUE **GLOBAL vĩnh viễn**, KHÔNG partial index.
2. **`users.role_id NOT NULL`:** thứ tự seed phải tạo `roles` trước khi tạo `users` trong transaction register (đã mô tả ở Flow 6).
3. **`permissions` Global không có `organization_id`:** đây là ngoại lệ hợp lệ theo ADR-003 — reviewer/migration cần lưu ý không áp rule tenant lên bảng này.
4. **Soft delete + unique email — [ĐÃ CHỐT bổ sung, thay thế đề xuất cũ]:** `users.email` UNIQUE global **thường** (không partial). Bản ghi xóa mềm **vẫn giữ chỗ** email → **KHÔNG cho phép tái sử dụng** email sau soft delete. (Quyết định bổ sung PO #1)
5. **Tenant enforcement (ADR-004):** ở tầng code, không ở DB — DB chỉ giữ FK. Cần test cô lập tenant ở bước Backend.
6. **Regex slug + enum status:** `organizations.slug` khớp `^[a-z0-9-]+$`; enum `UserStatus{ACTIVE,INACTIVE,LOCKED,SUSPENDED}`, `OrganizationStatus{ACTIVE,TRIAL,SUSPENDED,DELETED}`. Regex slug enforce ở validation + CHECK constraint (thêm ở bước migration).

> Các lưu ý trên là hướng dẫn cho bước Database, **không phải quyết định còn mở** — không cần PO chốt thêm để bắt đầu.

---

## 6. Đề xuất đồng bộ Source of Truth (không chặn)

ADR-022 (`errors[]`) làm thay đổi response chuẩn ở **CLAUDE.md Mục 12**. Đề nghị cập nhật CLAUDE.md Mục 12 để khớp khi có yêu cầu chỉnh Source of Truth (turn này chỉ được phép sửa `docs/auth.md` và `ADR.md`).

---

## 7. Kết luận

> **Tài liệu Auth đã ĐẦY ĐỦ và NHẤT QUÁN. Tất cả 18 quyết định đã ACCEPTED. Không còn điểm mở.**
>
> ✅ **Sẵn sàng chuyển sang bước Database (thiết kế schema & migration).**
>
> Chưa viết code, chưa sinh Prisma, chưa sinh Backend — chờ yêu cầu triển khai bước Database tiếp theo.
