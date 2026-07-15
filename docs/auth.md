# Auth Module — Production Documentation

> Module: **Authentication & RBAC Foundation**
> Product: **NCMedia Management Platform**
> Version: 2.0 · Status: **✅ ACCEPTED — sẵn sàng thiết kế Database** · Ngày: 2026-07-14
> Nguồn: `.claude/CLAUDE.md` + `architecture/ADR.md` (ADR-003, 004, 005, 006, 007, 008, 009, 010, 015, 016, 020, **021, 022, 023, 024**).
> Quyết định Product Owner: xem `docs/auth-decisions.md` (Decision-001 → 018, tất cả **ACCEPTED**). Bản ghi tại [Mục 21 — Decision Ledger](#21-decision-ledger).
>
> **Chú thích phạm vi:** 🟢 **S1** = Sprint 1 · 🟡 **S2+** = đặc tả production, triển khai sprint sau.
> Tài liệu này **không chứa code**, không sinh Prisma/NestJS. Khối JSON chỉ là hợp đồng dữ liệu (contract).

---

## 1. Business Goal

Cung cấp nền tảng xác thực (Authentication) và phân quyền (Authorization/RBAC) an toàn, đa tenant cho toàn bộ NCMedia Management Platform. Mọi module nghiệp vụ (Employee, Shop Account, Order, Report…) phụ thuộc module này để:

- Xác định **danh tính** người dùng.
- Xác định **tổ chức (tenant)** người dùng thuộc về — cô lập dữ liệu (ADR-003/004).
- Xác định **quyền hạn** (permission) để cho phép/từ chối hành động (ADR-010).

Mục tiêu đo lường: không rò rỉ dữ liệu chéo tenant; mật khẩu không bao giờ plaintext; cấp/phục hồi phiên an toàn qua refresh token.

---

## 2. Scope

| Chức năng | Phạm vi |
|---|---|
| Register Organization + tạo Admin đầu tiên | 🟢 S1 |
| Login (email + password) | 🟢 S1 |
| Refresh Token (rotation + reuse detection) | 🟢 S1 |
| Logout | 🟢 S1 |
| Seed Permission catalog + Role mặc định | 🟢 S1 |
| RBAC Foundation (User–Role–Permission, guard, `me`) | 🟢 S1 |
| Change Password | 🟡 S2+ |
| Forgot Password | 🟡 S2+ |
| Reset Password | 🟡 S2+ |
| Verify Email | 🟡 S2+ (Decision-010) |

---

## 3. Out of Scope

- SSO / OAuth2 / social login; MFA/2FA.
- Quản lý hồ sơ `Employee` (module Employee — ADR-007).
- Invite nhân viên qua email.
- Multi-Organization cho một User (ADR-008).
- Đăng nhập bằng số điện thoại.
- Audit Module đầy đủ (Sprint 1 chỉ mask PII — Decision-018, ADR-024).
- Row-level ownership chi tiết (chỉ đặt nền org-level + permission-level).

---

## 4. Actors

| Actor | Mô tả | Xác thực |
|---|---|---|
| **Guest** | Chưa đăng nhập | register, login, refresh, forgot-password, reset-password, verify-email |
| **Authenticated User** | Đã đăng nhập | me, logout, change-password |
| **Admin** | User mang Role `admin` | Toàn quyền trong Organization |
| **Employee / Fulfillment** | User mang Role tương ứng | Quyền theo permission được gán |
| **System (Seeder/Scheduler)** | Seed & dọn token hết hạn | Không qua HTTP |

Định danh (ADR-007/008): `Organization (1) → User (N)`; mỗi `User` thuộc đúng 1 `Organization` và mang **đúng 1 Role** (Decision-007).

---

## 5. User Story

| ID | Story | Scope |
|---|---|---|
| US-01 | Là Guest, tôi đăng ký Organization mới để trở thành Admin đầu tiên. | 🟢 S1 |
| US-02 | Là User, tôi đăng nhập để nhận Access + Refresh Token. | 🟢 S1 |
| US-03 | Là User, tôi làm mới Access Token bằng Refresh Token. | 🟢 S1 |
| US-04 | Là User, tôi đăng xuất để vô hiệu hóa phiên hiện tại. | 🟢 S1 |
| US-05 | Là User, tôi xem thông tin bản thân + quyền để FE render UI. | 🟢 S1 |
| US-06 | Là Admin, tôi xem danh sách Role và Permission catalog. | 🟢 S1 |
| US-07 | Là User, tôi đổi mật khẩu và các thiết bị khác bị đăng xuất. | 🟡 S2+ |
| US-08 | Là Guest quên mật khẩu, tôi yêu cầu link đặt lại qua email. | 🟡 S2+ |
| US-09 | Là Guest, tôi đặt lại mật khẩu bằng token trong email. | 🟡 S2+ |
| US-10 | Là User mới, tôi xác minh email để kích hoạt đầy đủ. | 🟡 S2+ |

---

## 6. Register Flow 🟢 S1

1. Guest gửi `POST /api/v1/auth/register` với `organizationName`, `fullName`, `email`, `password`.
2. Validate input (Mục 17). Sai → `400 VALIDATION_ERROR`.
3. Kiểm tra `email` chưa tồn tại (global unique — Decision-001). Trùng → `409 AUTH_EMAIL_EXISTS`.
4. **Bắt đầu transaction:**
   1. Tạo `Organization` (status `ACTIVE`, sinh `slug` unique — Decision-016).
   2. Băm mật khẩu bằng bcrypt cost 12 (Decision-003).
   3. Tạo `User` với `status = ACTIVE` (Decision-017).
   4. Seed 3 Role mặc định cho org: `admin`, `employee`, `fulfillment` (`is_system=true`) — ADR-009.
   5. Gán toàn bộ Permission (catalog) cho Role `admin`.
   6. Gán Role `admin` cho User (`users.role_id = admin.id` — Decision-007).
5. **Commit.** Lỗi bất kỳ → rollback toàn bộ.
6. Cấp Access (15') + Refresh (7 ngày) → lưu Refresh (hash) vào Redis.
7. Trả `201` kèm `{ user, organization, tokens }`.

**Edge cases:** email trùng (409); org name rỗng (400); lỗi giữa transaction → rollback (`500 INTERNAL_ERROR`).

---

## 7. Login Flow 🟢 S1

1. Guest gửi `POST /api/v1/auth/login` với `email`, `password`.
2. Rate-limit: **5 request/phút/IP** (Decision-005). Vượt → `429 RATE_LIMITED`.
3. Tìm User theo email (`deleted_at IS NULL`).
4. Kiểm tra khóa: nếu `locked_until > now` → `423 AUTH_ACCOUNT_LOCKED`.
5. Nếu không thấy User **hoặc** sai mật khẩu → `401 AUTH_INVALID_CREDENTIALS` (thông báo **chung**, chống enumeration). Tăng `failed_login_count` (đếm theo email + IP). Nếu đạt **5 lần sai** → set `locked_until = now + 15 phút` (Decision-004).
6. Nếu `status ∈ {INACTIVE, SUSPENDED}` → `403 AUTH_ACCOUNT_DISABLED`; nếu `status = LOCKED` → `423 AUTH_ACCOUNT_LOCKED`.
7. Thành công: reset `failed_login_count` & `locked_until`, cập nhật `last_login_at`, cấp Access + Refresh, lưu Refresh vào Redis.
8. Trả `200` kèm `{ user, tokens }`.

---

## 8. Refresh Flow 🟢 S1 (Rotation + Reuse Detection — Decision-006)

1. Client gửi `POST /api/v1/auth/refresh` với `refreshToken`. Rate-limit **30/phút/IP** (Decision-005).
2. Verify chữ ký (HS256 — Decision-009) & hạn JWT. Sai/hết hạn → `401 AUTH_REFRESH_INVALID`.
3. Tra Redis `refresh:{userId}:{jti}`. Không tồn tại → `401 AUTH_REFRESH_INVALID`.
4. So khớp hash token với giá trị lưu. **Không khớp → nghi ngờ reuse → thu hồi TOÀN BỘ refresh token của User** → `401 AUTH_REFRESH_INVALID`.
5. **Rotation:** xóa key `jti` cũ; sinh Access + Refresh mới (`jti` mới); lưu Redis mới.
6. Trả `200` kèm `{ tokens }`.

---

## 9. Logout Flow 🟢 S1

1. Authenticated User gửi `POST /api/v1/auth/logout` với `refreshToken` (Access ở header).
2. Xác định `jti`; xóa key Redis `refresh:{userId}:{jti}`.
3. Tùy chọn `logoutAll=true` → xóa toàn bộ `refresh:{userId}:*`.
4. Access Token còn hạn vẫn hợp lệ tối đa 15' (blacklist `jti` để sprint sau).
5. Trả `200`, `data = null`.

---

## 10. Change Password 🟡 S2+ (giữ phiên hiện tại — Decision-015)

1. User đăng nhập gửi `POST /api/v1/auth/change-password` với `currentPassword`, `newPassword`, `confirmPassword`.
2. Validate: khớp confirm, đạt password policy (Decision-002), khác `currentPassword`.
3. So khớp `currentPassword`. Sai → `401 AUTH_INVALID_CREDENTIALS`.
4. Băm `newPassword`, cập nhật `password_hash`, `password_changed_at = now`.
5. **Thu hồi toàn bộ Refresh Token** rồi **cấp cặp token mới cho phiên hiện tại** — đăng xuất mọi thiết bị khác, giữ phiên đang thao tác (Decision-015).
6. Gửi email thông báo đổi mật khẩu.
7. Trả `200` kèm `{ tokens }` mới.

---

## 11. Forgot Password 🟡 S2+

1. Guest gửi `POST /api/v1/auth/forgot-password` với `email`. Rate-limit **3/giờ/IP** (Decision-005).
2. Luôn trả `200` với thông báo trung tính (chống enumeration — không tiết lộ email tồn tại).
3. Nếu email tồn tại & active: sinh **reset token** opaque, entropy cao; lưu **hash** vào Redis `pwd_reset:{userId}:{jti}` TTL **30 phút** (Decision-012); gửi email link `.../reset-password?token=...`.
4. Chỉ 1 reset token hiệu lực tại một thời điểm (token mới vô hiệu token cũ).

---

## 12. Reset Password 🟡 S2+

1. Guest gửi `POST /api/v1/auth/reset-password` với `token`, `newPassword`, `confirmPassword`.
2. Validate password policy + khớp confirm.
3. Tra & so hash token trong Redis. Không hợp lệ/hết hạn/đã dùng → `400 AUTH_RESET_TOKEN_INVALID`.
4. Cập nhật `password_hash`, `password_changed_at`; xóa reset token; **thu hồi toàn bộ Refresh Token** của User.
5. Gửi email xác nhận đã đổi mật khẩu.
6. Trả `200` (không auto-login; yêu cầu login lại).

---

## 13. Verify Email 🟡 S2+ (Decision-010: Sprint 2)

**Phát hành token:** khi register (nếu bật) hoặc `POST /api/v1/auth/verify-email/resend`.
- Sinh **verification token** opaque; lưu hash vào Redis `email_verify:{userId}:{jti}` TTL **24 giờ** (Decision-011); gửi email link `.../verify-email?token=...`.

**Xác minh:**
1. Client gửi `POST /api/v1/auth/verify-email` với `token`.
2. Tra & so hash. Không hợp lệ/hết hạn → `400 AUTH_VERIFY_TOKEN_INVALID`.
3. Cập nhật `users.email_verified_at = now`; xóa token.
4. Trả `200`.

> **Lưu ý Sprint 1:** User mặc định `ACTIVE` (Decision-017) và verify email **không bắt buộc để login**. Toàn bộ flow này triển khai ở Sprint 2.

---

## 14. Business Rules

Tất cả BR dưới đây đã **ACCEPTED**. Ký hiệu nguồn: (ADR-xxx) hoặc (Decision-xxx).

**Định danh & Tenant**
- BR-01 Register tạo Organization + User(admin) + seed roles trong 1 transaction. (ADR-007, Mục 19)
- BR-02 1 User thuộc đúng 1 Organization. (ADR-008)
- BR-03 Mọi truy vấn nghiệp vụ kèm `organizationId` từ token; repository bắt buộc nhận `organizationId`. (ADR-004)
- BR-04 `email` **UNIQUE GLOBAL vĩnh viễn**. KHÔNG dùng partial unique index; soft delete **KHÔNG** cho phép tái sử dụng email (email đã xóa mềm vẫn giữ chỗ). (Decision-001 + bổ sung PO)

**Mật khẩu**
- BR-05 Hash bằng bcrypt; không lưu/không log plaintext. (ADR-006, Mục 15)
- BR-06 bcrypt cost = **12**. (Decision-003)
- BR-07 Policy: ≥ 8 ký tự, có ≥ 1 chữ và ≥ 1 số; khi đổi phải khác mật khẩu hiện tại. (Decision-002)
- BR-08 Đổi/đặt lại mật khẩu → thu hồi toàn bộ Refresh Token của User. (Decision-015)

**Token**
- BR-09 Access Token JWT hết hạn 15 phút; Refresh Token JWT hết hạn 7 ngày. (ADR-006)
- BR-10 Refresh Token lưu Redis (dạng hash). (ADR-006)
- BR-11 Refresh Token **Rotation + Reuse Detection**: reuse → thu hồi toàn phiên. (Decision-006)
- BR-12 JWT ký bằng **HS256** (Decision-009, ADR-021). Access payload: `sub`, `organizationId`, `role`, `jti`, `iat`, `exp`. `organizationId` là nguồn tenant context.

**Trạng thái tài khoản**
- BR-13 `UserStatus ∈ {ACTIVE, INACTIVE, LOCKED, SUSPENDED}` (bổ sung PO). User mới mặc định **ACTIVE** (Decision-017); login yêu cầu `status = ACTIVE`. `LOCKED` = trạng thái khóa bền vững (do bảo mật/PO); khóa tạm thời do đăng nhập sai vẫn dùng `locked_until` (transient, không đổi `status`). `INACTIVE`/`SUSPENDED` → không được login.
- BR-14 Khóa đăng nhập sau **5 lần sai** liên tiếp → khóa **15 phút**, tính theo (email + IP). (Decision-004)

**RBAC**
- BR-15 Permission **chỉ** gán cho Role — **không bao giờ** gán trực tiếp cho User. (ADR-010 + bổ sung PO)
- BR-16 Permission dạng `resource.action`. (ADR-010)
- BR-17 Role Dynamic; seed mặc định `admin`, `employee`, `fulfillment`; Role `is_system` không được xóa. (ADR-009)
- BR-18 Role `admin` được gán toàn bộ Permission. (Mục 4)
- BR-19 **Một User có đúng 1 Role** (`users.role_id`); KHÔNG dùng many-to-many. Quyền hiệu lực = permission của Role đó. (Decision-007)

**Chung**
- BR-20 Soft delete (`deleted_at`); bảng nghiệp vụ có cột audit + `organization_id`. (ADR-015, Mục 11)
- BR-21 Thông báo lỗi login/forgot trung tính để chống user enumeration.
- BR-22 `Permission` là bảng **Global** (không có `organization_id`). (Decision-008, ADR-003/011)
- BR-23 `Organization` có `slug` **unique**, phải khớp regex `^[a-z0-9-]+$` (chữ thường, số, dấu gạch ngang). (Decision-016 + bổ sung PO)
- BR-25 `OrganizationStatus ∈ {ACTIVE, TRIAL, SUSPENDED, DELETED}` (bổ sung PO).
- BR-26 `Role` gồm `code` + `display_name` (bổ sung PO).
- BR-24 Sprint 1: **mask PII trong log**, chưa triển khai Audit Module. (Decision-018, ADR-024)

---

## 15. Database Design

> Tuân thủ ADR-005/015 & CLAUDE.md Mục 11: UUID PK (không auto-increment), soft delete, cột audit,
> bảng nghiệp vụ có `organization_id`. Thiết kế trên tài liệu — **không sinh Prisma/migration.**

**Cột audit chung:** `id UUID PK`, `created_at`, `updated_at`, `deleted_at NULL`, `created_by UUID NULL`, `updated_by UUID NULL`.

### 15.1. Bảng

| Bảng | Loại | organization_id |
|---|---|---|
| `organizations` | Tenant root | — |
| `users` | Tenant-scoped | ✅ |
| `roles` | Tenant-scoped | ✅ |
| `permissions` | **Global catalog** | ❌ |
| `role_permissions` | Tenant-scoped | ✅ |

> **Không còn bảng `user_roles`** — do Decision-007 (một User một Role), quan hệ User→Role là khóa ngoại `users.role_id`.
> Ephemeral (Redis, không có bảng): refresh token, reset-password token, email-verify token, login-fail counter.

### 15.2. Cột chính

**organizations:** `name varchar(255)`, `slug varchar(120) UNIQUE NOT NULL` khớp regex `^[a-z0-9-]+$`, `status OrganizationStatus = ACTIVE` (enum `{ACTIVE, TRIAL, SUSPENDED, DELETED}`), + audit.

**users:**
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| organization_id | UUID | FK → organizations.id, NOT NULL |
| role_id | UUID | FK → roles.id, NOT NULL (Decision-007) |
| email | citext | NOT NULL, **UNIQUE GLOBAL vĩnh viễn** (không partial, không tái dùng khi soft delete) |
| password_hash | varchar(255) | NOT NULL |
| full_name | varchar(255) | NOT NULL |
| status | UserStatus | NOT NULL, default `ACTIVE` (enum `{ACTIVE, INACTIVE, LOCKED, SUSPENDED}`) |
| email_verified_at | timestamptz | NULL |
| password_changed_at | timestamptz | NULL |
| last_login_at | timestamptz | NULL |
| failed_login_count | int | NOT NULL default 0 |
| locked_until | timestamptz | NULL |
| + audit cols | | |

**roles:** `organization_id FK`, `code varchar(50)`, `display_name varchar(100)`, `is_system boolean=false`, + audit. UNIQUE `(organization_id, code)`.

**permissions (global):** `code varchar(100) UNIQUE`, `resource varchar(50)`, `action varchar(50)`, `description varchar(255) NULL`. (Không có `organization_id` — BR-22)

**role_permissions:** `organization_id FK`, `role_id FK`, `permission_id FK`, + audit. UNIQUE `(role_id, permission_id)`.

### 15.3. Chỉ mục
- `users(email)` unique; `users(organization_id)`; `users(role_id)`.
- `organizations(slug)` unique.
- `roles(organization_id, code)` unique.
- `role_permissions(role_id)`.

### 15.4. Redis keys
```
refresh:{userId}:{jti}       -> { tokenHash, organizationId, ua, ip, exp }   TTL 7d
pwd_reset:{userId}:{jti}      -> { tokenHash, exp }                          TTL 30m  (Decision-012)
email_verify:{userId}:{jti}   -> { tokenHash, exp }                          TTL 24h  (Decision-011)
login_fail:{email}:{ip}       -> counter                                     TTL 15m  (Decision-004)
```

### 15.5. ERD tóm tắt
```
organizations 1─┬─* users ─(role_id)→ roles ─* role_permissions *─ permissions (global)
                └─* roles
```

### 15.6. Seed
- Permission catalog (global), Sprint 1 tối thiểu: `organization.read`, `role.read/create/update/delete`, `permission.read`, `user.read/create/update/delete`.
- Khi register: 3 role hệ thống + gán full permission cho `admin` + set `users.role_id = admin`.

---

## 16. API Design

> Base `/api/v1` (Mục 12). Header `Authorization: Bearer <access>`. Envelope chuẩn bắt buộc.

**Success envelope**
```json
{ "success": true, "code": "SUCCESS", "message": "", "data": {}, "timestamp": "2026-07-14T00:00:00Z" }
```
**Error envelope** — có `errors[]` (Decision-013, ADR-022)
```json
{ "success": false, "code": "VALIDATION_ERROR", "message": "…",
  "errors": [{ "field": "email", "message": "…" }], "data": null, "timestamp": "…" }
```
**Pagination** — page/limit (Decision-014, ADR-023): query `?page=1&limit=20`; `meta:{ total, page, limit, totalPages }`.

| # | Method & Path | Scope | Auth | Permission | Mô tả |
|---|---|---|---|---|---|
| 1 | `POST /auth/register` | S1 | Guest | — | Tạo Org + Admin |
| 2 | `POST /auth/login` | S1 | Guest | — | Đăng nhập |
| 3 | `POST /auth/refresh` | S1 | Guest+token | — | Làm mới token |
| 4 | `POST /auth/logout` | S1 | User | — | Đăng xuất |
| 5 | `GET /auth/me` | S1 | User | — | Thông tin + quyền |
| 6 | `GET /roles` | S1 | User | `role.read` | Danh sách Role (tenant) |
| 7 | `GET /permissions` | S1 | User | `permission.read` | Catalog quyền (global) |
| 8 | `POST /auth/change-password` | S2+ | User | — | Đổi mật khẩu |
| 9 | `POST /auth/forgot-password` | S2+ | Guest | — | Yêu cầu đặt lại |
| 10 | `POST /auth/reset-password` | S2+ | Guest | — | Đặt lại qua token |
| 11 | `POST /auth/verify-email` | S2+ | Guest | — | Xác minh email |
| 12 | `POST /auth/verify-email/resend` | S2+ | Guest/User | — | Gửi lại link verify |

**Hợp đồng chính:**

`POST /auth/register` → req `{ organizationName, fullName, email, password }` → `201 { user, organization, tokens:{accessToken, refreshToken, expiresIn} }`.

`POST /auth/login` → req `{ email, password }` → `200 { user, tokens }`.

`POST /auth/refresh` → req `{ refreshToken }` → `200 { tokens }`.

`GET /auth/me` → `200 { user:{id,email,fullName,organizationId,status}, role:"admin", permissions:["role.read", …] }` (role đơn — Decision-007).

`GET /roles` / `GET /permissions` → phân trang page/limit, `meta:{ total, page, limit, totalPages }`.

### 16.1. Ma trận quyền (Sprint 1)
| Endpoint | Guest | Employee/Fulfillment | Admin |
|---|---|---|---|
| register / login / refresh | ✅ | ✅ | ✅ |
| logout / me | ❌ | ✅ | ✅ |
| GET roles / permissions | ❌ | ❌ | ✅ |

---

## 17. Validation Rules

FE validate bằng **Zod**, BE validate bằng **class-validator** trên DTO (CLAUDE.md Mục 13).

| Field | Rule |
|---|---|
| `organizationName` | required, 2–255 ký tự, trim |
| `fullName` | required, 2–255 ký tự |
| `email` | required, đúng định dạng, ≤ 255, normalize lowercase |
| `password` | required, ≥ 8, có ≥ 1 chữ và ≥ 1 số (Decision-002) |
| `newPassword` / `confirmPassword` | như `password`; khớp nhau; khác `currentPassword` |
| `refreshToken` / `token` | required, string non-empty |
| `page` / `limit` | integer ≥ 1; `limit` ≤ 100 |

Quy tắc chung: whitelist field (chặn field lạ), trim chuỗi, chuẩn hóa email lowercase trước khi kiểm tra unique.

---

## 18. Error Codes

| HTTP | code | Ý nghĩa |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Input không hợp lệ (kèm `errors[]`) |
| 401 | `AUTH_INVALID_CREDENTIALS` | Sai email hoặc mật khẩu |
| 401 | `AUTH_TOKEN_INVALID` | Access token sai/hết hạn |
| 401 | `AUTH_REFRESH_INVALID` | Refresh token sai/hết hạn/thu hồi/reuse |
| 403 | `AUTH_FORBIDDEN` | Thiếu permission |
| 403 | `AUTH_ACCOUNT_DISABLED` | Tài khoản `INACTIVE`/`SUSPENDED` |
| 403 | `AUTH_EMAIL_NOT_VERIFIED` | Chưa verify email (chỉ khi bật hard — S2+) |
| 409 | `AUTH_EMAIL_EXISTS` | Email đã tồn tại |
| 400 | `AUTH_RESET_TOKEN_INVALID` | Reset token sai/hết hạn/đã dùng |
| 400 | `AUTH_VERIFY_TOKEN_INVALID` | Verify token sai/hết hạn/đã dùng |
| 423 | `AUTH_ACCOUNT_LOCKED` | Khóa do đăng nhập sai nhiều lần (`locked_until`) hoặc `status = LOCKED` |
| 429 | `RATE_LIMITED` | Vượt rate limit |
| 500 | `INTERNAL_ERROR` | Lỗi hệ thống (rollback) |

Tuân thủ CLAUDE.md Mục 14: mọi error có `code`, `message`, `HTTP status`; dùng exception filter chuẩn, không throw trực tiếp.

---

## 19. Security

- **Password:** bcrypt cost 12 (Decision-003); không log plaintext; không trả `password_hash` ra API.
- **JWT:** **HS256** (Decision-009, ADR-021); secret lưu ở ENV/secret manager, **không hardcode** (ADR-020); có kế hoạch xoay secret. Access 15', Refresh 7 ngày (ADR-006).
- **Refresh token:** lưu **hash** trong Redis; rotation + reuse-detection (BR-11).
- **Tenant isolation:** `organizationId` luôn lấy từ token phía server, **không** tin giá trị client gửi; repository bắt buộc nhận `organizationId` (ADR-004).
- **Authorization:** guard kiểm tra permission `resource.action`; kiểm tra object thuộc đúng `organizationId` (chống IDOR/BOLA).
- **Rate limiting:** login 5/phút/IP, forgot 3/giờ/IP, refresh 30/phút/IP (Decision-005); `429` khi vượt.
- **Account lockout:** 5 lần sai → khóa 15' theo (email + IP) (Decision-004).
- **Anti-enumeration:** login & forgot trả thông báo trung tính (BR-21).
- **Transport & headers:** HTTPS bắt buộc; Helmet; CORS whitelist (Mục 15).
- **Token lộ:** đổi/đặt lại mật khẩu thu hồi toàn bộ refresh token (BR-08).
- **PII:** email là dữ liệu cá nhân — **mask trong log**, không log ở mức info (Decision-018, ADR-024). Audit Module đầy đủ để sprint sau.

---

## 20. Acceptance Criteria

**Chức năng (Sprint 1) 🟢**
- [ ] Register tạo Org (slug unique) + Admin (ACTIVE, role=admin) + seed 3 role + full permission cho admin, nguyên tử.
- [ ] Email trùng → `409 AUTH_EMAIL_EXISTS` (global unique).
- [ ] Login đúng cấp Access 15' + Refresh 7d; sai → `401` trung tính; 5 lần sai → khóa 15' (email+IP).
- [ ] Rate limit: login 5/phút/IP, refresh 30/phút/IP.
- [ ] Refresh rotation hoạt động; reuse bị phát hiện → thu hồi toàn phiên.
- [ ] Logout vô hiệu refresh token trong Redis.
- [ ] `GET /auth/me` trả `role` đơn + `permissions[]`.
- [ ] `GET /roles`, `GET /permissions` yêu cầu đúng permission; phân trang page/limit.
- [ ] Error envelope có `errors[]` cho lỗi validate field.
- [ ] JWT ký HS256, secret từ ENV (không hardcode).
- [ ] PII được mask trong log.

**Chức năng (Sprint 2+) 🟡**
- [ ] Change/Forgot/Reset Password và Verify Email theo Mục 10–13; đổi mật khẩu giữ phiên hiện tại, đăng xuất thiết bị khác; reset TTL 30', verify TTL 24h.

**Chất lượng (DoD — CLAUDE.md Mục 20)**
- [ ] Migration đầy đủ + seed; UUID PK; soft delete; cột audit đầy đủ.
- [ ] Mọi endpoint có DTO + validation + Swagger + error theo Mục 18.
- [ ] Tenant enforcement: repository nhận `organizationId`; có test cô lập tenant (2 org không thấy dữ liệu nhau).
- [ ] Rate limit login/forgot/refresh.
- [ ] Không lỗi TypeScript; không còn TODO/FIXME.
- [ ] Frontend: form Register/Login, lưu & tự refresh token, gọi `me`, guard route theo permission.
- [ ] Được review & chấp thuận.

---

## 21. Decision Ledger

Toàn bộ quyết định của Product Owner — trạng thái **ACCEPTED** (2026-07-14). Chi tiết: `docs/auth-decisions.md`.

| Decision | Nội dung chốt | Trạng thái | Phản ánh tại |
|---|---|---|---|
| 001 | Email global unique | ✅ ACCEPTED | BR-04, 15.2 |
| 002 | Password ≥ 8, có chữ + số | ✅ ACCEPTED | BR-07, Mục 17 |
| 003 | bcrypt cost = 12 | ✅ ACCEPTED | BR-06, Mục 19 |
| 004 | Login sai 5 lần → khóa 15' (email+IP) | ✅ ACCEPTED | BR-14, Flow 7 |
| 005 | Rate limit login 5/phút, forgot 3/giờ, refresh 30/phút (per IP) | ✅ ACCEPTED | Mục 19 |
| 006 | Refresh Rotation + Reuse Detection | ✅ ACCEPTED | BR-11, Flow 8 |
| 007 | Một User một Role (không m2m) | ✅ ACCEPTED | BR-19, 15.1/15.2 |
| 008 | Permission là Global | ✅ ACCEPTED | BR-22, 15.1 (ADR-003/011) |
| 009 | JWT HS256 | ✅ ACCEPTED | BR-12, Mục 19 (**ADR-021**) |
| 010 | Verify Email để Sprint 2 | ✅ ACCEPTED | Mục 2, 13 |
| 011 | Verify Token TTL 24h | ✅ ACCEPTED | Flow 13, 15.4 |
| 012 | Reset Password TTL 30' | ✅ ACCEPTED | Flow 11/12, 15.4 |
| 013 | Response chuẩn có `errors[]` | ✅ ACCEPTED | Mục 16, 18 (**ADR-022**) |
| 014 | Pagination page/limit | ✅ ACCEPTED | Mục 16 (**ADR-023**) |
| 015 | Đổi mật khẩu giữ phiên hiện tại, logout thiết bị khác | ✅ ACCEPTED | Flow 10, BR-08 |
| 016 | Organization có slug unique | ✅ ACCEPTED | BR-23, 15.2 |
| 017 | User mặc định ACTIVE | ✅ ACCEPTED | BR-13, Flow 6 |
| 018 | Sprint 1 chỉ mask PII, chưa có Audit Module | ✅ ACCEPTED | BR-24, Mục 19 (**ADR-024**) |

> **Tài liệu đã ACCEPTED — sẵn sàng chuyển sang bước Database (thiết kế schema/migration) theo workflow ADR-019.** Chưa sinh code cho tới khi có yêu cầu triển khai.
