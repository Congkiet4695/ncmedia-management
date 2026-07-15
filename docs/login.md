# Login — Production Documentation

> Feature: **Login (Đăng nhập)** — thuộc module **Authentication & RBAC Foundation**
> Product: **NCMedia Management Platform**
> Version: 1.0 · Status: **✅ ACCEPTED — sẵn sàng thiết kế/triển khai theo workflow ADR-019** · Ngày: 2026-07-15
> Nguồn (đọc theo thứ tự): `.claude/CLAUDE.md` → `architecture/ADR.md` → `docs/auth.md`.
> ADR liên quan: ADR-003, 004, 005, 006, 007, 008, 009, 010, 015, 016, 020, **021, 022, 023, 024**.
> Quyết định Product Owner: `docs/auth-decisions.md` (Decision-001 → 018, tất cả **ACCEPTED**).
>
> **Chú thích phạm vi:** 🟢 **S1** = Sprint 1 (triển khai) · 🟡 **S2+** = đặc tả, triển khai sprint sau.
> Tài liệu này **không chứa code**, không sinh Prisma/NestJS/Frontend. Khối JSON chỉ là hợp đồng dữ liệu (contract).

---

> ## ⚠️ Điểm cần đồng bộ (Reconciliation note) — Refresh Token Store
>
> Có mâu thuẫn giữa các tài liệu về nơi lưu Refresh Token:
> - **`architecture/ADR.md` — ADR-006 (Revision 2026-07-14):** **Database (`refresh_tokens`) là Source of Truth**; **Redis chỉ là Cache**; token lưu dạng **hash HMAC-SHA256**; Rotation + Reuse Detection quản lý qua `revoked_at`, `replaced_by_id`.
> - **`docs/auth.md §8, §15.4` và `docs/database.md §9`:** mô tả Refresh Token là **ephemeral chỉ trong Redis** (không có bảng).
>
> **Quy tắc giải quyết:** Theo `.claude/CLAUDE.md` — *"Khi có mâu thuẫn giữa CLAUDE.md và ADR.md, ADR.md là nguồn quyết định kiến trúc"*. Vì vậy tài liệu này **tuân theo ADR-006 (DB là Source of Truth, Redis là Cache)**.
>
> **Hành động đề xuất (ngoài phạm vi tài liệu này, theo ADR-020 không tự ý sửa):** Product Owner cần cập nhật `docs/auth.md §8/§15.4` và `docs/database.md §9` cho khớp ADR-006 (bổ sung bảng `refresh_tokens`). Xem [Mục 10](#10-refresh-token--s1) và [Mục 18](#18-database-sử-dụng).

---

## 1. Mục tiêu

Cung cấp cơ chế **đăng nhập an toàn, đa tenant** cho NCMedia Management Platform. Login là cổng vào của toàn bộ hệ thống: mọi module nghiệp vụ (Employee, Shop Account, Order, Report…) đều phụ thuộc phiên đăng nhập để xác định danh tính, tổ chức (tenant) và quyền hạn.

Cụ thể, Login phải:

- **Xác thực danh tính** người dùng bằng `email` + `password` (ADR-006, ADR-007).
- **Xác định tenant**: nhúng `organizationId` vào Access Token để cô lập dữ liệu (ADR-003/004).
- **Cấp phiên**: phát hành **Access Token (15')** + **Refresh Token (7 ngày)** (ADR-006).
- **Chống lạm dụng**: rate limit, khóa tài khoản khi sai nhiều lần, thông báo lỗi trung tính chống enumeration (Decision-004, 005, BR-21).
- **Bảo vệ mật khẩu**: so khớp bcrypt cost 12, không bao giờ log/trả plaintext hoặc `password_hash` (Decision-003, BR-05).

**Mục tiêu đo lường:** không rò rỉ dữ liệu chéo tenant; mật khẩu không bao giờ plaintext; brute-force bị chặn; token cấp/thu hồi an toàn.

**Phi mục tiêu (không thuộc Login):** Register (xem `auth.md §6`), Change/Forgot/Reset Password, Verify Email, SSO/OAuth2, MFA/2FA — xem `auth.md §3`.

---

## 2. Use Case

**UC-Login — Đăng nhập bằng email + mật khẩu**

| Thuộc tính | Nội dung |
|---|---|
| **ID** | UC-LOGIN-01 |
| **Actor chính** | Guest (chưa đăng nhập) — có thể là User mang bất kỳ Role nào: `admin`, `employee`, `fulfillment`, hoặc Role động khác |
| **Tiền điều kiện** | User đã tồn tại (tạo qua Register), `status = ACTIVE`, `deleted_at IS NULL` |
| **Kích hoạt** | Người dùng submit form đăng nhập (email + password) |
| **Luồng chính** | 1. Gửi `POST /api/v1/auth/login`. 2. Hệ thống kiểm tra rate limit. 3. Tìm User theo email. 4. Kiểm tra khóa tài khoản. 5. So khớp mật khẩu. 6. Kiểm tra trạng thái tài khoản. 7. Cấp Access + Refresh Token. 8. Trả `200` kèm `{ user, tokens }`. |
| **Hậu điều kiện** | `last_login_at` được cập nhật; `failed_login_count`/`locked_until` reset; Refresh Token mới được lưu (DB + Redis cache) |
| **Luồng phụ / ngoại lệ** | Xem [Mục 5 — Login Flow](#5-login-flow--s1) và [Mục 12 — Error Code](#12-error-code) |

**Bảng tóm tắt Actor → khả năng đăng nhập:**

| Actor | Đăng nhập? | Ghi chú |
|---|---|---|
| Guest có tài khoản `ACTIVE` | ✅ | Luồng chuẩn |
| User `INACTIVE` / `SUSPENDED` | ❌ | `403 AUTH_ACCOUNT_DISABLED` |
| User `LOCKED` (bền vững) hoặc `locked_until > now` (tạm thời) | ❌ | `423 AUTH_ACCOUNT_LOCKED` |
| User đã soft-delete (`deleted_at` ≠ NULL) | ❌ | Coi như không tồn tại → `401` trung tính |

**User Story liên quan (auth.md §5):** US-02 — *"Là User, tôi đăng nhập để nhận Access + Refresh Token."* 🟢 S1.

---

## 3. Requirement

### 3.1. Functional Requirement

| ID | Yêu cầu | Nguồn |
|---|---|---|
| FR-01 | Endpoint `POST /api/v1/auth/login` nhận `{ email, password }`. | auth.md §7, §16 |
| FR-02 | Đăng nhập bằng **email** (global unique) + **password**, không cần chọn Organization. | Decision-001 |
| FR-03 | So khớp mật khẩu bằng **bcrypt** (cost 12). | Decision-003, BR-05/06 |
| FR-04 | Thành công → cấp **Access Token 15'** + **Refresh Token 7 ngày**. | ADR-006, BR-09 |
| FR-05 | Access Token payload chứa `sub`, `organizationId`, `role`, `jti`, `iat`, `exp`. | ADR-021, BR-12 |
| FR-06 | Cập nhật `last_login_at`; reset `failed_login_count` & `locked_until` khi thành công. | auth.md §7 |
| FR-07 | Lưu Refresh Token (hash) — DB là Source of Truth, Redis là cache. | ADR-006 |
| FR-08 | Trả response theo envelope chuẩn `{ success, code, message, data, timestamp }`. | CLAUDE.md §12 |

### 3.2. Non-Functional Requirement

| ID | Yêu cầu | Nguồn |
|---|---|---|
| NFR-01 | **Rate limit** login: 5 request/phút/IP. | Decision-005 |
| NFR-02 | **Account lockout**: 5 lần sai liên tiếp → khóa 15', tính theo (email + IP). | Decision-004, BR-14 |
| NFR-03 | **Anti-enumeration**: sai email hoặc sai mật khẩu đều trả cùng `401 AUTH_INVALID_CREDENTIALS`. | BR-21 |
| NFR-04 | **Tenant isolation**: `organizationId` chỉ lấy từ dữ liệu server, không tin client. | ADR-004 |
| NFR-05 | **PII masking**: email được mask trong log, không log ở mức info. | Decision-018, ADR-024 |
| NFR-06 | **Transport**: HTTPS bắt buộc; Helmet; CORS whitelist. | CLAUDE.md §15 |
| NFR-07 | **Validation** bắt buộc qua DTO (BE) + Zod (FE); Swagger đầy đủ. | CLAUDE.md §13 |

### 3.3. Ràng buộc kiến trúc (không được vi phạm — ADR-020)

- Không hardcode secret/dữ liệu; secret JWT lấy từ ENV/secret manager (ADR-020, ADR-021).
- Không đặt business logic trong Controller; dùng Service + Repository (CLAUDE.md §8, ADR-016).
- Repository bắt buộc nhận `organizationId` cho truy vấn nghiệp vụ (ADR-004). *(Riêng bước tra User theo email khi login là trước khi có tenant context — tra theo email global unique, sau đó `organizationId` được suy ra từ chính bản ghi User.)*
- Chỉ triển khai đúng phạm vi Sprint 1 (CLAUDE.md §19).

---

## 4. Business Rules

Áp dụng cho Login (trích & khu biệt từ `auth.md §14`). Tất cả **ACCEPTED**.

**Xác thực**
- **BR-L01** Đăng nhập bằng `email` + `password`; `email` là **UNIQUE GLOBAL** nên không cần chọn Organization. (Decision-001, BR-04)
- **BR-L02** Mật khẩu so khớp bằng **bcrypt cost 12**; không log/không trả plaintext hay `password_hash`. (Decision-003, BR-05/06)
- **BR-L03** Chỉ xét User `deleted_at IS NULL`. User soft-delete coi như không tồn tại.

**Trạng thái tài khoản**
- **BR-L04** Chỉ `status = ACTIVE` được login. `INACTIVE`/`SUSPENDED` → `403 AUTH_ACCOUNT_DISABLED`. (BR-13)
- **BR-L05** `status = LOCKED` (khóa bền vững do bảo mật/PO) **hoặc** `locked_until > now` (khóa tạm thời) → `423 AUTH_ACCOUNT_LOCKED`. (BR-13)

**Chống brute-force**
- **BR-L06** Sai email hoặc sai mật khẩu → cùng thông báo `401 AUTH_INVALID_CREDENTIALS` (trung tính, chống enumeration). (BR-21)
- **BR-L07** Mỗi lần sai tăng `failed_login_count`, đếm theo **(email + IP)**. Đạt **5 lần sai** → `locked_until = now + 15 phút`. (Decision-004, BR-14)
- **BR-L08** Đăng nhập thành công → reset `failed_login_count = 0`, xóa `locked_until`, cập nhật `last_login_at`. (auth.md §7)

**Token & phiên**
- **BR-L09** Thành công → cấp **Access (15')** + **Refresh (7 ngày)**; JWT ký **HS256**. (ADR-006, ADR-021, BR-09/12)
- **BR-L10** Access payload: `sub`, `organizationId`, `role`, `jti`, `iat`, `exp`. `organizationId` là nguồn tenant context phía server. (BR-12)
- **BR-L11** Refresh Token lưu dạng **hash** — **DB (`refresh_tokens`) là Source of Truth, Redis là cache** (ADR-006). Áp dụng Rotation + Reuse Detection khi refresh (xem Mục 10). (BR-11)

**Chung**
- **BR-L12** Response tuân thủ envelope chuẩn; lỗi validate kèm `errors[]`. (ADR-022, CLAUDE.md §12)
- **BR-L13** Sprint 1: mask PII (email) trong log; chưa có Audit Module đầy đủ. (Decision-018, ADR-024)

---

## 5. Login Flow 🟢 S1

> Nguồn: `auth.md §7`. Thứ tự các bước là **bắt buộc** (fail-fast, ưu tiên bảo mật).

1. **Nhận request:** Guest gửi `POST /api/v1/auth/login` với `{ email, password }`.
2. **Validate input** (Mục 6). Sai định dạng → `400 VALIDATION_ERROR` (kèm `errors[]`).
3. **Rate limit:** kiểm tra **5 request/phút/IP** (Decision-005). Vượt → `429 RATE_LIMITED`.
4. **Chuẩn hóa email:** trim + lowercase trước khi tra cứu.
5. **Tìm User** theo `email` với `deleted_at IS NULL`.
6. **Kiểm tra khóa tạm thời/bền vững:** nếu `locked_until > now` **hoặc** `status = LOCKED` → `423 AUTH_ACCOUNT_LOCKED`.
7. **So khớp danh tính:** nếu **không thấy User** *hoặc* **sai mật khẩu** (bcrypt compare) →
   - Tăng `failed_login_count` (đếm theo **email + IP**).
   - Nếu đạt **5 lần sai** → set `locked_until = now + 15 phút`.
   - Trả `401 AUTH_INVALID_CREDENTIALS` (thông báo **chung**, chống enumeration).
8. **Kiểm tra trạng thái tài khoản:** nếu `status ∈ {INACTIVE, SUSPENDED}` → `403 AUTH_ACCOUNT_DISABLED`. *(status `LOCKED` đã chặn ở bước 6.)*
9. **Thành công:**
   1. Reset `failed_login_count = 0`, xóa `locked_until`.
   2. Cập nhật `last_login_at = now`.
   3. Nạp `role` (code) + danh sách `permissions[]` của User (qua `role_permissions`) để nhúng/claim.
   4. Cấp **Access Token** (HS256, exp 15') + **Refresh Token** (HS256, exp 7 ngày, `jti` mới).
   5. **Lưu Refresh Token**: ghi bản ghi vào `refresh_tokens` (hash HMAC-SHA256, `expires_at`, `user_agent`, `ip`) — DB là Source of Truth; đồng thời set cache Redis `refresh:{userId}:{jti}` TTL 7 ngày (ADR-006).
10. **Trả `200`** kèm `{ user, tokens }`.

### 5.1. Sequence (mô tả)

```
Client → API: POST /auth/login { email, password }
API → RateLimiter(Redis): check 5/min/IP           ── vượt → 429 RATE_LIMITED
API → UserRepo: findByEmail(email, deleted_at IS NULL)
API: if locked_until > now OR status=LOCKED         ── → 423 AUTH_ACCOUNT_LOCKED
API: bcrypt.compare(password, password_hash)
     if !user OR !match → inc failed_login_count(email+ip)
                          if count>=5 → set locked_until=now+15m
                          → 401 AUTH_INVALID_CREDENTIALS
API: if status in {INACTIVE, SUSPENDED}             ── → 403 AUTH_ACCOUNT_DISABLED
API: reset counters, set last_login_at
API: sign Access(15m) + Refresh(7d, jti)
API → refresh_tokens(DB): insert(hash, exp, ua, ip)  [Source of Truth]
API → Redis: SET refresh:{userId}:{jti} TTL 7d       [Cache]
API → Client: 200 { user, tokens }
```

---

## 6. Validation

> FE validate bằng **Zod**; BE validate bằng **class-validator** trên DTO (CLAUDE.md §13, auth.md §17).

**Request `POST /auth/login`:**

| Field | Rule |
|---|---|
| `email` | required · đúng định dạng email · ≤ 255 ký tự · normalize **lowercase + trim** |
| `password` | required · string non-empty |

**Quy tắc chung:**
- **Whitelist field** — chặn field lạ (không cho phép field ngoài `email`, `password`).
- Trim chuỗi; chuẩn hóa email lowercase **trước** khi tra cứu/so khớp.
- **Không** áp policy độ phức tạp mật khẩu ở Login (policy chỉ áp khi Register/Change/Reset — Decision-002). Login chỉ yêu cầu non-empty để tránh lộ thông tin về định dạng mật khẩu đã lưu.
- Lỗi validate → `400 VALIDATION_ERROR` kèm `errors[]` (mỗi phần tử `{ field, message }` — ADR-022).

**Ví dụ error validate:**
```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Dữ liệu không hợp lệ",
  "errors": [
    { "field": "email", "message": "Email không đúng định dạng" },
    { "field": "password", "message": "Mật khẩu là bắt buộc" }
  ],
  "data": null,
  "timestamp": "2026-07-15T00:00:00Z"
}
```

---

## 7. Rate Limit

> Nguồn: Decision-005, auth.md §19. Store đếm ở **Redis**.

| Thuộc tính | Giá trị |
|---|---|
| Endpoint | `POST /api/v1/auth/login` |
| Ngưỡng | **5 request / phút / IP** |
| Khóa đếm | theo **IP** nguồn |
| Vượt ngưỡng | `429 RATE_LIMITED` |
| Cơ chế | Fixed/sliding window trên Redis (ví dụ key `rl:login:{ip}` TTL 60s) |

**Ghi chú:**
- Rate limit (theo IP) là lớp phòng thủ **độc lập** với Account lockout (theo email + IP). Cả hai cùng hoạt động.
- Ngưỡng các endpoint auth khác để tham chiếu: `refresh` 30/phút/IP; `forgot-password` 3/giờ/IP (S2+).
- Nên trả header chuẩn (ví dụ `Retry-After`) khi `429` để FE xử lý backoff (khuyến nghị triển khai).

---

## 8. Lock Account

> Nguồn: Decision-004, BR-14, auth.md §7, database.md §2.

Phân biệt **hai loại khóa**:

| Loại | Cột | Nguyên nhân | Thời gian | Đổi `status`? |
|---|---|---|---|---|
| **Tạm thời (transient)** | `locked_until` (timestamptz) | Đăng nhập sai 5 lần liên tiếp | 15 phút | ❌ Không |
| **Bền vững (persistent)** | `status = LOCKED` | Quyết định bảo mật / Product Owner | Tới khi được mở thủ công | ✅ Có |

**Cơ chế khóa tạm thời (chính cho Login):**
1. Mỗi lần đăng nhập sai (sai email **hoặc** sai mật khẩu) → tăng bộ đếm theo **(email + IP)**.
   - Bộ đếm lưu ở Redis: `login_fail:{email}:{ip}`, TTL 15 phút (database.md §9).
   - Đồng bộ `users.failed_login_count` (persist) để phục vụ nghiệp vụ/kiểm tra.
2. Khi bộ đếm đạt **5** → set `users.locked_until = now + 15 phút`.
3. Trong khi `locked_until > now` → mọi login trả `423 AUTH_ACCOUNT_LOCKED` (kể cả nhập đúng mật khẩu).
4. Đăng nhập thành công (sau khi hết khóa) → reset `failed_login_count = 0`, xóa `locked_until`, xóa key Redis đếm.

**Chống lạm dụng (DoS khóa tài khoản người khác):** đếm theo **(email + IP)** thay vì chỉ email, kết hợp thông báo trung tính (BR-21) — theo đúng phân tích Decision-004.

**Mở khóa bền vững (`status = LOCKED`):** ngoài phạm vi Login — do Admin/PO thao tác (module quản trị User, sprint sau).

---

## 9. JWT

> Nguồn: ADR-006, **ADR-021**, BR-09/12, auth.md §19.

| Thuộc tính | Access Token | Refresh Token |
|---|---|---|
| Loại | JWT | JWT |
| Thuật toán ký | **HS256** | **HS256** |
| Thời hạn (`exp`) | **15 phút** | **7 ngày** |
| Nơi dùng | Header `Authorization: Bearer <access>` | Body request `refresh`/`logout` |
| Secret | ENV / secret manager — **không hardcode** | ENV / secret manager |

**Access Token payload (claims):**

| Claim | Ý nghĩa |
|---|---|
| `sub` | User ID (UUID) |
| `organizationId` | Tenant context — **nguồn cô lập dữ liệu** (ADR-004) |
| `role` | Mã Role đơn của User (ví dụ `admin`) — Decision-007 (một User một Role) |
| `jti` | ID phiên token (dùng cho rotation/thu hồi) |
| `iat` | Thời điểm phát hành |
| `exp` | Thời điểm hết hạn |

**Ràng buộc bảo mật:**
- Secret ký JWT **không hardcode**, lấy từ ENV/secret manager; có kế hoạch xoay secret (ADR-020, ADR-021).
- `organizationId` **luôn** lấy từ token phía server khi xử lý request nghiệp vụ — **không** tin giá trị client gửi (ADR-004).
- Có thể chuyển sang **RS256** khi tách service (ghi chú trong ADR-021) — không thuộc phạm vi hiện tại.
- Response `tokens` gồm: `{ accessToken, refreshToken, expiresIn }` (auth.md §16).

---

## 10. Refresh Token 🟢 S1

> **Nguồn quyết định: ADR-006 (Revision 2026-07-14).** Xem [Điểm cần đồng bộ](#️-điểm-cần-đồng-bộ-reconciliation-note--refresh-token-store) ở đầu tài liệu.

Mặc dù Refresh Flow là endpoint riêng (`POST /auth/refresh`), Login là nơi **phát hành** Refresh Token đầu tiên, nên đặc tả lưu trữ & vòng đời được nêu ở đây để nhất quán.

### 10.1. Lưu trữ (theo ADR-006)

- **Database `refresh_tokens` là Source of Truth.** Token lưu dạng **hash HMAC-SHA256** (không plaintext).
- **Redis là Cache** (`refresh:{userId}:{jti}`) để tra cứu nhanh, TTL 7 ngày. Redis **không** phải nguồn chính; khi cache miss thì tra DB.
- Rotation + Reuse Detection quản lý qua các cột `revoked_at`, `replaced_by_id` trong `refresh_tokens`.

### 10.2. Phát hành khi Login

1. Sinh Refresh JWT (HS256, `jti` mới, exp 7 ngày).
2. Ghi 1 bản ghi `refresh_tokens`: `token_hash` (HMAC-SHA256), `jti`, `user_id`, `organization_id`, `user_agent`, `ip`, `expires_at`, `revoked_at = NULL`, `replaced_by_id = NULL`.
3. Set cache Redis `refresh:{userId}:{jti}` (TTL 7 ngày).

### 10.3. Rotation + Reuse Detection (khi `POST /auth/refresh`)

> Nguồn: Decision-006, BR-11, auth.md §8 (đã ánh xạ sang mô hình DB của ADR-006).

1. Verify chữ ký (HS256) & hạn JWT. Sai/hết hạn → `401 AUTH_REFRESH_INVALID`.
2. Tra bản ghi theo `jti` (cache Redis trước, fallback DB `refresh_tokens`).
3. So khớp `token_hash` (HMAC-SHA256). **Không khớp / bản ghi đã `revoked_at`** → **nghi ngờ reuse → thu hồi TOÀN BỘ Refresh Token của User** (set `revoked_at` cho tất cả bản ghi còn hiệu lực) → `401 AUTH_REFRESH_INVALID`.
4. **Rotation:** đánh dấu bản ghi cũ `revoked_at = now`, `replaced_by_id = <id mới>`; sinh Access + Refresh mới (`jti` mới); ghi bản ghi mới + cập nhật cache; xóa cache `jti` cũ.
5. Trả `200` kèm `{ tokens }`.

### 10.4. Thu hồi khi Logout

- `POST /auth/logout` với `refreshToken` → xác định `jti` → set `revoked_at = now` cho bản ghi + xóa cache `refresh:{userId}:{jti}`.
- `logoutAll=true` → thu hồi toàn bộ `refresh_tokens` của User + xóa toàn bộ cache `refresh:{userId}:*`.
- Access Token còn hạn vẫn hợp lệ tối đa 15' (blacklist `jti` để sprint sau — auth.md §9).

---

## 11. Response

> Envelope chuẩn (CLAUDE.md §12) + `errors[]` cho lỗi validate (ADR-022). `Content-Type: application/json`.

### 11.1. Thành công — `200 OK`

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Đăng nhập thành công",
  "data": {
    "user": {
      "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
      "email": "admin@ncmedia.com",
      "fullName": "Nguyen Van A",
      "organizationId": "b1c2d3e4-0000-4a00-8000-000000000001",
      "status": "ACTIVE",
      "role": "admin"
    },
    "tokens": {
      "accessToken": "<jwt-access>",
      "refreshToken": "<jwt-refresh>",
      "expiresIn": 900
    }
  },
  "timestamp": "2026-07-15T00:00:00Z"
}
```

**Ghi chú:**
- `expiresIn = 900` (giây) = 15 phút — thời hạn Access Token.
- **Không** trả `password_hash` hay bất kỳ dữ liệu nhạy cảm nào (BR-05, auth.md §19).
- `role` là **đơn** (một User một Role — Decision-007). Danh sách `permissions[]` đầy đủ lấy qua `GET /auth/me` (auth.md §16).

### 11.2. Lỗi — envelope chung

```json
{
  "success": false,
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "Email hoặc mật khẩu không đúng",
  "errors": [],
  "data": null,
  "timestamp": "2026-07-15T00:00:00Z"
}
```

---

## 12. Error Code

> Trích từ `auth.md §18`, khu biệt cho Login. Mọi error có `code`, `message`, `HTTP status`; dùng exception filter chuẩn NestJS, **không** throw trực tiếp (CLAUDE.md §14).

| HTTP | code | Khi nào (trong Login) |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Input sai định dạng (kèm `errors[]`) |
| 401 | `AUTH_INVALID_CREDENTIALS` | Sai email **hoặc** sai mật khẩu (thông báo trung tính) |
| 403 | `AUTH_ACCOUNT_DISABLED` | Tài khoản `INACTIVE` / `SUSPENDED` |
| 423 | `AUTH_ACCOUNT_LOCKED` | `locked_until > now` (khóa tạm 15') **hoặc** `status = LOCKED` |
| 429 | `RATE_LIMITED` | Vượt 5 request/phút/IP |
| 500 | `INTERNAL_ERROR` | Lỗi hệ thống |

**Nguyên tắc trung tính (BR-21):** không phân biệt "email không tồn tại" và "sai mật khẩu" — cả hai đều `401 AUTH_INVALID_CREDENTIALS` để chống user enumeration.

---

## 13. Swagger

> CLAUDE.md §13 (Swagger bắt buộc), auth.md §16. Đặc tả OpenAPI cho endpoint Login.

**Endpoint:** `POST /api/v1/auth/login`
**Tag:** `Auth`
**Security:** none (Guest)
**Summary:** Đăng nhập bằng email + mật khẩu, trả Access + Refresh Token.

**Request body (`application/json`):**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `email` | string | ✅ | format email, ≤ 255, lowercase |
| `password` | string | ✅ | non-empty |

**Responses:**

| Code | Mô tả | Schema |
|---|---|---|
| `200` | Đăng nhập thành công | `LoginSuccessResponse` (`data.user`, `data.tokens`) |
| `400` | Input không hợp lệ | `ErrorResponse` (kèm `errors[]`) |
| `401` | Sai thông tin đăng nhập | `ErrorResponse` |
| `403` | Tài khoản bị vô hiệu hóa | `ErrorResponse` |
| `423` | Tài khoản bị khóa | `ErrorResponse` |
| `429` | Vượt rate limit | `ErrorResponse` |
| `500` | Lỗi hệ thống | `ErrorResponse` |

**Yêu cầu tài liệu Swagger:**
- Mọi DTO có decorator mô tả (`@ApiProperty`) với ví dụ (example) — **không** ví dụ chứa mật khẩu thật/PII thật.
- Mô tả rõ envelope chuẩn + `errors[]`.
- Nhóm dưới tag `Auth`; đánh dấu Guest (không cần Bearer).

---

## 14. Security

> Nguồn: CLAUDE.md §15, auth.md §19, các Decision liên quan.

- **Password:** bcrypt cost 12 (Decision-003); so khớp bằng `bcrypt.compare`; **không** log plaintext; **không** trả `password_hash`.
- **JWT:** HS256 (ADR-021); secret ở ENV/secret manager, **không hardcode** (ADR-020); Access 15', Refresh 7 ngày.
- **Refresh token:** lưu **hash HMAC-SHA256**; DB Source of Truth + Redis cache; rotation + reuse detection (ADR-006, BR-11).
- **Tenant isolation:** `organizationId` lấy từ token phía server, **không** tin client (ADR-004).
- **Rate limiting:** login 5/phút/IP (Decision-005) → `429`.
- **Account lockout:** 5 lần sai → khóa 15' theo (email + IP) (Decision-004) → `423`.
- **Anti-enumeration:** thông báo lỗi login **trung tính** (BR-21).
- **Transport & headers:** HTTPS bắt buộc; Helmet; CORS whitelist (CLAUDE.md §15).
- **Input validation:** whitelist field, chặn field lạ, chuẩn hóa email (Mục 6).
- **PII:** email là dữ liệu cá nhân — **mask trong log**, không log ở mức info (Decision-018, ADR-024).
- **Timing:** nên so khớp bcrypt kể cả khi không tìm thấy User (dummy compare) để giảm rò rỉ qua thời gian phản hồi — hỗ trợ chống enumeration (khuyến nghị triển khai).

---

## 15. Audit Log

> Nguồn: Decision-018, ADR-024, BR-24.

**Phạm vi Sprint 1 (áp dụng):**
- **Mask PII** trong log ứng dụng: **không** log email ở mức `info`; nếu cần chẩn đoán, mask (ví dụ `a***@ncmedia.com`).
- Chỉ log sự kiện lỗi hệ thống / bảo mật ở mức phù hợp, **không** kèm PII/plaintext.
- **Chưa** triển khai **Audit Module** đầy đủ (ghi vết hành động) — để sprint sau.

**Sự kiện Login nên được ghi khi có Audit Module (Sprint sau — đặc tả, không triển khai S1):**
- Đăng nhập thành công (userId, organizationId, ip, ua, thời điểm).
- Đăng nhập thất bại (email đã mask, ip, lý do trung tính).
- Khóa tài khoản (userId/email mask, ip, `locked_until`).

> Ràng buộc: kể cả khi có Audit Module, **không** ghi mật khẩu/`password_hash`/token plaintext vào audit (BR-05, Mục 14).

---

## 16. Acceptance Criteria

**Chức năng (Sprint 1) 🟢**
- [ ] `POST /api/v1/auth/login` nhận `{ email, password }`, validate DTO đầy đủ.
- [ ] Email chuẩn hóa lowercase + trim trước khi tra cứu.
- [ ] Đăng nhập đúng → cấp Access 15' + Refresh 7d; response theo envelope chuẩn `{ user, tokens }`.
- [ ] Access Token payload chứa `sub`, `organizationId`, `role`, `jti`, `iat`, `exp`; ký HS256; secret từ ENV.
- [ ] Sai email hoặc sai mật khẩu → `401 AUTH_INVALID_CREDENTIALS` (thông báo trung tính, không phân biệt).
- [ ] 5 lần sai liên tiếp (email + IP) → `locked_until = now + 15'`; trong thời gian khóa trả `423 AUTH_ACCOUNT_LOCKED` kể cả nhập đúng.
- [ ] `status ∈ {INACTIVE, SUSPENDED}` → `403 AUTH_ACCOUNT_DISABLED`; `status = LOCKED` → `423 AUTH_ACCOUNT_LOCKED`.
- [ ] Vượt 5 request/phút/IP → `429 RATE_LIMITED`.
- [ ] Đăng nhập thành công → reset `failed_login_count`, xóa `locked_until`, cập nhật `last_login_at`.
- [ ] Refresh Token được lưu **hash** vào `refresh_tokens` (DB Source of Truth) + cache Redis (theo ADR-006).
- [ ] User soft-delete (`deleted_at` ≠ NULL) không đăng nhập được (coi như không tồn tại → `401`).
- [ ] Response **không** chứa `password_hash` hay PII thừa.
- [ ] Lỗi validate trả `errors[]` (ADR-022).

**Chất lượng (DoD — CLAUDE.md §20)**
- [ ] DTO + validation (class-validator) + Swagger đầy đủ cho endpoint Login.
- [ ] Error handling qua exception filter chuẩn; mọi error có `code` + `message` + HTTP status.
- [ ] PII (email) được mask trong log.
- [ ] Không lỗi TypeScript; không còn TODO/FIXME.
- [ ] Có Unit Test cho Service (các nhánh: thành công, sai mật khẩu, khóa, disabled, rate limit).
- [ ] Frontend: form Login (React Hook Form + Zod), lưu token, hiển thị lỗi theo field.
- [ ] Được review & chấp thuận trước khi chuyển bước.

---

## 17. Test Cases

| ID | Tiền điều kiện | Hành động | Kết quả mong đợi |
|---|---|---|---|
| TC-L01 | User `ACTIVE`, mật khẩu đúng | Login đúng email + password | `200`, trả `{ user, tokens }`; `last_login_at` cập nhật; `failed_login_count = 0` |
| TC-L02 | User tồn tại | Login đúng email, **sai** mật khẩu | `401 AUTH_INVALID_CREDENTIALS`; `failed_login_count += 1` |
| TC-L03 | Không có User với email này | Login email không tồn tại | `401 AUTH_INVALID_CREDENTIALS` (giống TC-L02, trung tính) |
| TC-L04 | User `ACTIVE` | Nhập sai mật khẩu **5 lần** liên tiếp (cùng IP) | Lần 5 → set `locked_until = now + 15'` |
| TC-L05 | `locked_until > now` | Login **đúng** mật khẩu trong thời gian khóa | `423 AUTH_ACCOUNT_LOCKED` |
| TC-L06 | `locked_until` đã qua | Login đúng mật khẩu sau khi hết khóa | `200`; reset counter + xóa `locked_until` |
| TC-L07 | User `status = INACTIVE` | Login đúng mật khẩu | `403 AUTH_ACCOUNT_DISABLED` |
| TC-L08 | User `status = SUSPENDED` | Login đúng mật khẩu | `403 AUTH_ACCOUNT_DISABLED` |
| TC-L09 | User `status = LOCKED` | Login đúng mật khẩu | `423 AUTH_ACCOUNT_LOCKED` |
| TC-L10 | — | Gọi login **6 lần trong 1 phút** từ cùng IP | Request thứ 6 → `429 RATE_LIMITED` |
| TC-L11 | — | Body thiếu `password` | `400 VALIDATION_ERROR`, `errors[]` chứa field `password` |
| TC-L12 | — | `email` sai định dạng | `400 VALIDATION_ERROR`, `errors[]` chứa field `email` |
| TC-L13 | User `ACTIVE`, email viết HOA/khoảng trắng | Login `  ADMIN@NCMedia.com ` đúng mật khẩu | `200` (email chuẩn hóa lowercase + trim) |
| TC-L14 | User soft-deleted (`deleted_at` ≠ NULL) | Login đúng mật khẩu | `401 AUTH_INVALID_CREDENTIALS` (coi như không tồn tại) |
| TC-L15 | Login thành công | Kiểm tra Access Token | Payload có `sub`, `organizationId`, `role`, `jti`, `iat`, `exp`; ký HS256; exp = 15' |
| TC-L16 | Login thành công | Kiểm tra lưu Refresh Token | Có bản ghi `refresh_tokens` (hash) + cache Redis `refresh:{userId}:{jti}` TTL 7d |
| TC-L17 | Login thành công | Kiểm tra response body | Không chứa `password_hash` |
| TC-L18 | Login thất bại nhiều lần | Kiểm tra log | Email được **mask**, không log plaintext mật khẩu |
| TC-L19 | 2 org khác nhau | Login user org A → dùng token gọi API nghiệp vụ org B | Không thấy dữ liệu org B (tenant isolation qua `organizationId` trong token) |
| TC-L20 | User `ACTIVE` | Sai mật khẩu từ **2 IP khác nhau** | Bộ đếm khóa theo (email + IP) — mỗi IP đếm riêng (chống DoS khóa tài khoản) |

---

## 18. Database sử dụng

> Nguồn: `docs/database.md`, `auth.md §15`. Thiết kế trên tài liệu — **không sinh migration**. Quy ước: UUID PK, soft delete, cột audit, `organization_id` cho bảng nghiệp vụ (ADR-005/015).

### 18.1. Bảng đọc/ghi trong Login

| Bảng | Thao tác trong Login | Cột liên quan |
|---|---|---|
| `users` | **Đọc**: tìm theo `email` (`deleted_at IS NULL`). **Ghi**: cập nhật `failed_login_count`, `locked_until`, `last_login_at`. | `id`, `organization_id`, `role_id`, `email` (citext, UNIQUE global), `password_hash`, `status` (`UserStatus`), `failed_login_count`, `locked_until`, `last_login_at` |
| `roles` | **Đọc**: lấy `code` Role của User (nhúng vào `role` claim). | `id`, `code`, `organization_id` |
| `role_permissions` | **Đọc**: lấy permission của Role (phục vụ `me`/authorization). | `role_id`, `permission_id`, `organization_id` |
| `permissions` (global) | **Đọc**: map `permission_id → code` (`resource.action`). | `id`, `code` |
| `refresh_tokens` | **Ghi**: insert bản ghi khi phát hành Refresh Token (theo ADR-006). | xem 18.2 |

### 18.2. Bảng `refresh_tokens` (theo ADR-006 — Source of Truth)

> ⚠️ Bảng này **bắt buộc theo ADR-006** nhưng **chưa** xuất hiện trong `docs/database.md §9` (đang mô tả Redis-only). Đây là thiết kế đề xuất bám ADR-006; **`database.md` cần được cập nhật bởi Product Owner** (xem [Điểm cần đồng bộ](#️-điểm-cần-đồng-bộ-reconciliation-note--refresh-token-store)). Không tự ý sửa (ADR-020).

| Cột | Kiểu | Ràng buộc / Ghi chú |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users.id`, NOT NULL |
| `organization_id` | uuid | FK → `organizations.id`, NOT NULL (tenant-scoped, ADR-015) |
| `jti` | uuid/varchar | ID phiên token, UNIQUE |
| `token_hash` | varchar | **HMAC-SHA256** của Refresh Token (không plaintext) |
| `user_agent` | varchar | NULL — thiết bị/UA phát hành |
| `ip` | varchar | NULL — IP phát hành |
| `expires_at` | timestamptz | NOT NULL — 7 ngày kể từ phát hành |
| `revoked_at` | timestamptz | NULL — set khi thu hồi/rotation/reuse |
| `replaced_by_id` | uuid | NULL — trỏ tới bản ghi kế nhiệm (rotation) |
| + audit cols | | `created_at`, `updated_at`, … |

### 18.3. Không thay đổi

- **Không** tạo/sửa bảng ngoài phạm vi trên. Cấu trúc `users`, `roles`, `permissions`, `role_permissions` theo `database.md §4` — giữ nguyên.
- **Không** sinh Prisma/migration trong tài liệu này (CLAUDE.md §18, database.md §9).

---

## 19. Redis sử dụng

> Nguồn: `database.md §9`, `auth.md §15.4`, ADR-006. Redis dùng cho dữ liệu ephemeral + cache + rate limit.

| Key | Nội dung | TTL | Vai trò trong Login |
|---|---|---|---|
| `login_fail:{email}:{ip}` | counter | 15 phút (Decision-004) | Đếm số lần đăng nhập sai theo (email + IP) → khóa tạm |
| `rl:login:{ip}` *(hoặc tương đương của thư viện rate-limit)* | counter | 60 giây | Rate limit 5 request/phút/IP (Decision-005) |
| `refresh:{userId}:{jti}` | `{ tokenHash, organizationId, ua, ip, exp }` | 7 ngày | **Cache** tra cứu Refresh Token nhanh (Source of Truth là DB — ADR-006) |

**Ghi chú:**
- Theo ADR-006, Redis với refresh token là **cache**, không phải nguồn chính. Khi cache miss → tra `refresh_tokens` (DB).
- Key rate limit có thể do thư viện (ví dụ throttler) tự quản lý — tên key mang tính minh họa.
- Không lưu mật khẩu/plaintext token trong Redis (chỉ hash — BR-05, Mục 14).

---

## 20. Phạm vi Sprint

> Nguồn: CLAUDE.md §19 (Sprint 1), auth.md §2/§3.

**Trong phạm vi Sprint 1 (Login) 🟢**
- `POST /api/v1/auth/login` — đăng nhập email + password.
- Rate limit login (5/phút/IP).
- Account lockout tạm thời (5 lần sai → 15').
- Cấp Access (15') + Refresh (7 ngày); lưu Refresh (hash) theo ADR-006.
- Validation + Swagger + Error handling theo chuẩn.
- Mask PII trong log.
- Unit Test cho Service + Frontend form Login.

**Ngoài phạm vi Login / Sprint 1 (không triển khai) 🟡**
- Change Password / Forgot Password / Reset Password (auth.md §10–12) — S2+.
- Verify Email (auth.md §13) — S2+.
- Blacklist Access Token khi logout (auth.md §9) — sprint sau.
- Audit Module đầy đủ (chỉ mask PII ở S1) — ADR-024, sprint sau.
- SSO / OAuth2 / MFA / đăng nhập bằng SĐT — auth.md §3.
- Multi-Organization cho một User — ADR-008.
- Mở khóa `status = LOCKED` (thao tác quản trị) — module quản lý User, sprint sau.

**Ràng buộc quy trình (ADR-019):** Login đi theo thứ tự Requirement → Business Rule → Database → API → Backend (kèm Unit Test) → Frontend → **Review** → Merge. **Không** bỏ qua Review.

---

> **Kết luận:** Tài liệu Login đã đầy đủ 20 mục yêu cầu, bám sát CLAUDE.md + ADR.md + auth.md, và nêu rõ điểm cần đồng bộ (Refresh Token Store theo ADR-006). **Chưa sinh code** (Backend/Frontend/migration) — chờ bước triển khai theo workflow ADR-019.
