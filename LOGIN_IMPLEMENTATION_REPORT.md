# LOGIN Implementation Report

> Module: **Authentication** · Feature: **Login** (Sprint 1)
> Product: **NCMedia Management Platform** · Ngày: 2026-07-15
> Nguồn: `.claude/CLAUDE.md`, `architecture/ADR.md`, `docs/auth.md`, `docs/login.md`, `docs/database.md`.
> Phạm vi: **CHỈ Login**. Không implement Register/Refresh/Logout/Me/RBAC/Forgot/Reset/Verify.

---

## 1. Các file đã tạo

| # | File | Vai trò |
|---|---|---|
| 1 | `apps/backend/src/modules/auth/dto/login-request.dto.ts` | `LoginRequestDto` — validate `email` (format, lowercase, ≤255) + `password` (non-empty). Swagger `@ApiProperty`. |
| 2 | `apps/backend/src/modules/auth/dto/login-response.dto.ts` | `LoginResponseDto`, `LoginUserDto`, `LoginTokensDto` — hợp đồng response (login.md Mục 11). |
| 3 | `apps/backend/src/modules/auth/login.controller.ts` | `LoginController` — `POST /api/v1/auth/login`, chỉ gọi Service, Swagger đầy đủ. |
| 4 | `apps/backend/src/modules/auth/services/login.service.ts` | `LoginService` — điều phối toàn bộ flow 15 bước (login.md Mục 5). |
| 5 | `apps/backend/src/modules/auth/services/refresh-token.service.ts` | `RefreshTokenService.createRefreshToken()` — hash HMAC-SHA256 + lưu DB (Source of Truth) + Redis cache (ADR-006). |
| 6 | `apps/backend/src/modules/auth/services/rate-limit.service.ts` | `RateLimitService` — bộ đếm Redis (fixed window) cho rate limit + đếm login sai. |
| 7 | `apps/backend/src/modules/auth/services/login.service.spec.ts` | Unit test `LoginService` (6 case bắt buộc + defined). |
| 8 | `apps/backend/src/modules/auth/exceptions/invalid-credentials.exception.ts` | `AUTH_INVALID_CREDENTIALS` (401). |
| 9 | `apps/backend/src/modules/auth/exceptions/account-disabled.exception.ts` | `AUTH_ACCOUNT_DISABLED` (403). |
| 10 | `apps/backend/src/modules/auth/exceptions/account-locked.exception.ts` | `AUTH_ACCOUNT_LOCKED` (423). |
| 11 | `apps/backend/src/modules/auth/exceptions/rate-limited.exception.ts` | `RATE_LIMITED` (429). |
| 12 | `apps/backend/src/common/utils/mask-email.util.ts` | `maskEmail()` — mask PII khi log (Decision-018 / ADR-024). |

---

## 2. Các file đã sửa

| # | File | Thay đổi |
|---|---|---|
| 1 | `apps/backend/src/modules/auth/services/token.service.ts` | **Thêm** `createAccessToken()` và `createRefreshToken()` (JWT HS256, payload `sub/organizationId/role/jti`, không chứa permissions). Giữ nguyên `issueTokens()` của Register. |
| 2 | `apps/backend/src/modules/auth/services/user.service.ts` | `findByEmail()` **include `role`** (lấy role.code cho JWT). **Thêm** `increaseFailedLogin()`, `resetFailedLogin()`, `updateLastLogin()`. |
| 3 | `apps/backend/src/modules/auth/auth.module.ts` | Đăng ký `LoginController` + `LoginService`, `RefreshTokenService`, `RateLimitService`. |

> **Không sửa** Prisma schema, ADR, `docs/*`, hay flow Register.

---

## 3. Flow Login (đã implement — login.md Mục 5)

`POST /api/v1/auth/login` → `LoginController` → `LoginService.login()`:

1. **Validate input** — `ValidationPipe` (global, whitelist) + `LoginRequestDto`.
2. **Rate limit** — `RateLimitService.hit('login_rl:{ip}', 5, 60s)`; vượt → `429 RATE_LIMITED`.
3. **Normalize email** — trim + lowercase (DTO `@Transform` + phòng thủ trong service).
4. **Find user** — `UserService.findByEmail()` (kèm `role`).
5. **Check deleted** — `deletedAt != null` → coi như không tồn tại.
6. **Check locked** — `status = LOCKED` hoặc `locked_until > now` → `423 AUTH_ACCOUNT_LOCKED`.
7. **bcrypt.compare** — **luôn chạy** (dummy hash khi user không tồn tại → chống timing attack). Sai/không có user → đếm sai theo `login_fail:{email}:{ip}` (TTL 15'), đạt 5 → set `locked_until = now+15'`; ném `401 AUTH_INVALID_CREDENTIALS` (trung tính).
8. **Check status** — `ACTIVE` đi tiếp; `LOCKED` → 423; `INACTIVE`/`SUSPENDED` → `403 AUTH_ACCOUNT_DISABLED`.
9. **Reset failed_login_count** — trong transaction.
10. **Update last_login_at** — trong transaction.
11. **Generate Access Token** — HS256, TTL 15'.
12. **Generate Refresh Token** — HS256, TTL 7 ngày, `jti` mới.
13. **Save Refresh Token (DB)** — `refresh_tokens`, hash HMAC-SHA256 (Source of Truth — ADR-006), trong transaction.
14. **Save Redis Cache** — `refresh:{userId}:{jti}` → tokenHash, TTL 7 ngày.
15. **Return Response** — `{ user, tokens }` (bọc envelope chuẩn bởi `TransformInterceptor`).

> **Transaction (Section 9):** bước 9, 10, 13, 14 chạy trong `prisma.$transaction`. Access token (bước 11) tạo ngoài transaction (không ghi DB). Sau commit: xóa bộ đếm sai `login_fail:{email}:{ip}`.

---

## 4. Các Business Rule đã implement

| Rule | Nội dung | Vị trí |
|---|---|---|
| BR-L01 | Login bằng email (global unique) + password | `LoginRequestDto`, `findByEmail` |
| BR-L02 | bcrypt so khớp; không trả `password_hash`/PII | `login.service.ts`, `LoginUserDto` |
| BR-L03 | Bỏ qua user soft-deleted (`deleted_at`) | `login.service.ts` (bước 5) |
| BR-L04 | INACTIVE/SUSPENDED → 403 | `assertStatusAllowsLogin()` |
| BR-L05 | `status=LOCKED` hoặc `locked_until>now` → 423 | `isLocked()`, `assertStatusAllowsLogin()` |
| BR-L06 | Sai email/password → cùng `401` trung tính (+ dummy bcrypt chống timing) | `login.service.ts` (bước 7) |
| BR-L07 | Đếm sai theo (email+IP), 5 lần → khóa 15' | `registerFailure()`, `UserService.increaseFailedLogin()` |
| BR-L08 | Thành công → reset counter, xóa lock, cập nhật `last_login_at` | `resetFailedLogin()`, `updateLastLogin()` |
| BR-L09 | Access 15' + Refresh 7d, HS256 | `TokenService` |
| BR-L10 | Access payload `sub/organizationId/role/jti/iat/exp` | `TokenService.createAccessToken()` |
| BR-L11 | Refresh hash HMAC-SHA256, DB Source of Truth + Redis cache | `RefreshTokenService` |
| BR-L12 | Envelope chuẩn + `errors[]` | `TransformInterceptor`, `AllExceptionsFilter` (có sẵn) |
| BR-L13 | Mask PII (email) trong log; không log password/token | `maskEmail()`, redact ở `LoggerModule` |
| NFR-01 | Rate limit 5/phút/IP | `RateLimitService` |
| NFR-04 | `organizationId` từ dữ liệu server (không tin client) | JWT payload từ bản ghi User |

---

## 5. Những gì CHƯA implement (đúng phạm vi — không làm)

- **Refresh Flow** (verify/rotation/reuse-detection/revoke) — chỉ tạo & lưu refresh token khi Login.
- **Register / Logout / Me / RBAC Guard** — ngoài phạm vi (Register đã có từ trước, không đụng).
- **Forgot / Reset / Change Password, Verify Email** — Sprint 2+.
- **Blacklist Access Token khi logout** — sprint sau (auth.md Mục 9).
- **Audit Module đầy đủ** — Sprint 1 chỉ mask PII (ADR-024).
- **Frontend form Login** — không thuộc nhiệm vụ backend này.
- **Migration/DB schema** — không thay đổi (bảng `refresh_tokens`/`users` dùng nguyên trạng; `refresh_tokens` không có cột `jti` → `jti` nằm trong JWT + khóa Redis).

---

## 6. Kết quả build

```
> ncmedia-management-backend@0.1.0 build
> nest build
```

✅ **Build thành công** — không có lỗi TypeScript.

---

## 7. Kết quả test

```
> ncmedia-management-backend@0.1.0 test
> jest --passWithNoTests

PASS src/modules/auth/services/permission.service.spec.ts
PASS src/modules/auth/services/organization.service.spec.ts
PASS src/modules/auth/services/token.service.spec.ts
PASS src/modules/auth/services/role.service.spec.ts
PASS src/modules/auth/services/user.service.spec.ts
PASS src/modules/auth/services/register.service.spec.ts
PASS src/modules/auth/services/login.service.spec.ts

Test Suites: 7 passed, 7 total
Tests:       21 todo, 13 passed, 34 total
Time:        ~7 s
```

✅ **Toàn bộ test pass.** `LoginService` — 6/6 case bắt buộc xanh:

- ✓ Login success (trả user + tokens, reset counter, cập nhật last_login)
- ✓ Wrong password (`AUTH_INVALID_CREDENTIALS` + tăng failed_login_count)
- ✓ Email not found (`AUTH_INVALID_CREDENTIALS` trung tính, có chạy bcrypt.compare)
- ✓ Locked account (`AUTH_ACCOUNT_LOCKED`, chặn trước khi so mật khẩu)
- ✓ Disabled account (`AUTH_ACCOUNT_DISABLED`)
- ✓ Rate limit (`RATE_LIMITED`, không tra user)

---

## 8. Ghi chú kỹ thuật

- **Refresh Token = JWT HS256** (theo login.md Mục 10 & ADR-006). Bảng `refresh_tokens` không có cột `jti`/`organization_id` → không sửa schema; `jti` được mang trong JWT và dùng làm khóa Redis `refresh:{userId}:{jti}`, DB định danh bản ghi qua `token_hash` (UNIQUE).
- **Redis-in-transaction:** cache Redis được ghi trong callback transaction (sau khi ghi DB). Nếu commit fail, client không nhận token và cache mồ côi tự hết hạn theo TTL — vô hại.
- **`issueTokens()` của Register giữ nguyên** (dùng refresh token opaque) để không thay đổi hành vi Register; Login dùng nhánh `createAccessToken()`/`createRefreshToken()` mới.
- **Rate limit** dùng Redis trực tiếp (dự án chưa có `@nestjs/throttler`) — không thêm dependency mới.

---

> **Kết luận:** Chức năng **Login** đã implement hoàn chỉnh theo `docs/login.md`, build sạch, test xanh. Không mở rộng ngoài phạm vi Login.
