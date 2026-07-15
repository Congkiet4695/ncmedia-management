# LOGIN — Final Review

> Module: **Authentication** · Feature: **Login** (Sprint 1)
> Product: **NCMedia Management Platform** · Ngày: 2026-07-15
> Phạm vi review: **CHỈ Login**. Không thêm feature, không refactor ngoài phạm vi Login.
> Nguồn đối chiếu: `.claude/CLAUDE.md`, `architecture/ADR.md`, `docs/auth.md`, `docs/login.md`, `docs/database.md`.

---

## 0. Tổng kết

| Hạng mục | Kết quả |
|---|---|
| Build (`nest build`) | ✅ Pass — không lỗi TypeScript |
| Test (`jest`) | ✅ 7 suite pass · Login 6/6 case + defined |
| Lỗi phải sửa (đã sửa) | **1** — Redis I/O trong Prisma transaction |
| Ghi chú / khuyến nghị (không phải lỗi) | 6 |
| Đánh giá chung | ✅ **Đạt** — sẵn sàng review/merge |

---

## 1. Lỗi đã phát hiện & đã sửa

### [FIXED] Redis write nằm TRONG Prisma `$transaction` (Performance / Redis best-practice / Race)

**Trước:** `RefreshTokenService.createRefreshToken()` ghi DB (`tx.refreshToken.create`) **và** ghi Redis (`redis.set`) trong cùng callback `$transaction` của `LoginService`.

**Vấn đề:**
- Giữ kết nối DB + row lock (bản ghi `users` vừa update) mở trong lúc chờ I/O mạng tới Redis → tăng thời gian giữ transaction, giảm throughput dưới tải.
- Nếu transaction **rollback** sau khi đã `redis.set` → cache Redis mồ côi (trỏ tới token không tồn tại trong DB).
- Trộn hai nguồn ghi (transactional DB + non-transactional Redis) trong một ranh giới nguyên tử → sai mô hình.

**Sửa:** Tách trách nhiệm theo ADR-006 (DB là Source of Truth, Redis là Cache):
- `createRefreshToken(tx, …)` → **chỉ** ký JWT + hash HMAC + ghi DB trong transaction; trả `IssuedRefreshToken`.
- `cacheRefreshToken(issued)` → ghi Redis **sau khi commit**, gọi **best-effort** (bọc `try/catch`, lỗi cache chỉ `warn`, không làm hỏng Login vì Refresh Flow sẽ fallback DB).

**File:** `services/refresh-token.service.ts`, `services/login.service.ts`, `services/login.service.spec.ts`.
**Kết quả:** build + test xanh; transaction chỉ còn thao tác DB; cache là bước phụ sau commit.

---

## 2. Kết quả kiểm tra theo 16 tiêu chí

### 2.1. Clean Architecture ✅
- Phân tầng rõ: `Controller` (điều hướng) → `Service` (business) → `Prisma/Redis` (hạ tầng). Không rò rỉ Prisma/Redis lên Controller.
- Controller `LoginController` **không chứa business logic** (chỉ map request → `loginService.login`).
- DTO tách biệt input/output; exception là lớp domain riêng.

### 2.2. SOLID ✅
- **S:** mỗi service một trách nhiệm — `LoginService` (điều phối), `TokenService` (ký JWT), `RefreshTokenService` (hash + lưu trữ refresh), `RateLimitService` (đếm Redis), `UserService` (thao tác User).
- **O/L:** exception kế thừa `HttpException` chuẩn; thêm loại khóa mới không phá vỡ caller.
- **D:** phụ thuộc qua DI/abstraction của Nest, không `new` trực tiếp; secret qua `ConfigService`.

### 2.3. NestJS Best Practice ✅
- Global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform) đã có ở `main.ts`.
- Global `AllExceptionsFilter` chuẩn hóa envelope; `TransformInterceptor` bọc success.
- Provider khai báo đúng trong `AuthModule`; dùng `@Injectable`, `@Ip()`, `@Headers()`.
- Không đặt logic trong constructor (trừ `dummyHash` — xem 3.5).

### 2.4. Prisma Transaction ✅ (sau khi sửa)
- Cập nhật trạng thái (`resetFailedLogin`, `updateLastLogin`) + lưu refresh token (DB) nằm trong **một** `$transaction` → nguyên tử (Section 9 của yêu cầu).
- Access token ký ngoài transaction (không ghi DB) — đúng.
- Redis cache ra **ngoài** transaction (đã sửa).
- `increment: 1` cho `failed_login_count` là atomic ở DB (không read-modify-write).

### 2.5. Validation ✅
- `LoginRequestDto`: `email` (`@IsEmail`, `@MaxLength(255)`, `@Transform` lowercase+trim), `password` (`@IsString`, `@IsNotEmpty`) — khớp login.md Mục 6 (login **không** áp password policy).
- `forbidNonWhitelisted` chặn field lạ → `400 VALIDATION_ERROR` kèm `errors[]` (ADR-022).

### 2.6. Swagger ✅
- `@ApiTags('Auth')`, `@ApiOperation`, `@ApiOkResponse(type: LoginResponseDto)`, và các response `400/401/403/423/429` (423 khai báo qua `@ApiResponse` vì Nest không có helper 423).
- DTO có `@ApiProperty` với example (không dùng PII/secret thật).

### 2.7. Security ✅
- Mật khẩu so khớp `bcrypt.compare`; **không** trả `password_hash`/PII trong response.
- **Chống timing attack:** luôn chạy `bcrypt.compare` (dummy hash khi user không tồn tại) — BR-L06.
- **Anti-enumeration:** sai email/mật khẩu đều `401 AUTH_INVALID_CREDENTIALS` (BR-L21).
- **Rate limit** 5/phút/IP + **lockout** 5 lần sai/(email+IP) → 15'.
- **Mask PII** (email) trong toàn bộ log của `LoginService`; không log password/token; `LoggerModule` redact thêm ở tầng HTTP.
- `organizationId` lấy từ bản ghi User (server-side), nhúng vào JWT — không tin client (ADR-004).
- Secret JWT/HMAC lấy từ ENV (`getOrThrow`), **không hardcode** (ADR-020/021), validate ở `env.validation.ts`.

### 2.8. JWT ✅
- Access & Refresh ký **HS256** tường minh (`algorithm: 'HS256'`), Access 15', Refresh 7 ngày (ADR-006/021).
- Payload Access: `sub, organizationId, role, jti` (+ `iat/exp`) — **không** chứa permissions (login.md Mục 9).
- Access & Refresh dùng secret khác nhau (`accessSecret` ≠ `refreshSecret`); refresh còn hash bằng `refreshHmacSecret` riêng.

### 2.9. Redis ✅ (sau khi sửa)
- Redis đúng vai trò **Cache** (ADR-006): `refresh:{userId}:{jti}` lưu **hash**, TTL = hạn refresh; cache best-effort.
- Bộ đếm `login_rl:{ip}` (TTL 60s) và `login_fail:{email}:{ip}` (TTL 15') dùng `INCR` (atomic) + `EXPIRE` ở lần đầu.
- Client Redis là singleton toàn cục (`RedisModule @Global`) — không mở kết nối mỗi request.

### 2.10. PostgreSQL ✅
- Không đổi schema. Dùng đúng cột hiện có của `users` (`failed_login_count`, `locked_until`, `last_login_at`) và `refresh_tokens` (`token_hash` UNIQUE, `expires_at`, `ip_address`, `user_agent`).
- `email` tra cứu qua unique index (citext) — hiệu quả.
- `jti`/`organization_id` **không** tồn tại trên `refresh_tokens` → không cố ghi (jti nằm trong JWT + khóa Redis) → không cần migration.

### 2.11. Business Rule ✅
Đã đối chiếu BR-L01…L13 + NFR trong login.md — tất cả implement (xem bảng ở `LOGIN_IMPLEMENTATION_REPORT.md` Mục 4). Flow 15 bước đúng thứ tự login.md Mục 5.

### 2.12. Memory Leak ✅
- Không listener/timer/subscription tạo theo request; không closure giữ tham chiếu lớn.
- `dummyHash` tính **một lần** lúc khởi tạo singleton (không phải mỗi request).
- Redis/Prisma là singleton có `onModuleDestroy` dọn dẹp. Không phát hiện rò rỉ.

### 2.13. Race Condition ✅ (chấp nhận được)
- `INCR` (Redis) và `increment` (Prisma) đều atomic → đếm sai/khóa an toàn khi login đồng thời.
- Nhiều login thành công song song → mỗi phiên một refresh token (jti riêng); `last_login_at` last-write-wins (vô hại).
- Không còn giữ transaction trong lúc I/O Redis (đã sửa) → giảm cửa sổ tranh chấp lock.

### 2.14. Error Handling ✅
- Dùng exception chuẩn NestJS với `{ code, message }`, không throw chuỗi thô; filter map ra HTTP + envelope.
- Transaction lỗi → log (mask) + rethrow → `500 INTERNAL_ERROR`.
- Cache Redis lỗi / `reset` lỗi → nuốt lỗi có kiểm soát (không làm hỏng login).

### 2.15. Naming Convention ✅
- File `kebab-case`, class `PascalCase`, method/biến `camelCase`, hằng `UPPER_SNAKE`.
- Đặt tên rõ nghĩa: `registerFailure`, `assertStatusAllowsLogin`, `isLocked`, `IssuedRefreshToken`. Nhất quán với code Register có sẵn.

### 2.16. Performance ✅
- Đường thành công: 1 lần `findByEmail` (indexed) + 1 `bcrypt.compare` + ký 2 JWT + transaction (2 update + 1 insert) + 1 Redis set. Hợp lý.
- `bcrypt` cost 12 (~250ms) là chi phí cố ý (Decision-003).
- Đã loại I/O Redis khỏi transaction (giảm thời gian giữ lock).

---

## 3. Ghi chú & khuyến nghị (không phải lỗi — không sửa để giữ đúng phạm vi/spec)

1. **Hai câu UPDATE trên `users`** (`resetFailedLogin` + `updateLastLogin`) trong transaction: giữ **tách hàm** đúng theo yêu cầu API trước đó; chi phí thừa 1 round-trip là không đáng kể cho login. Nếu tối ưu sau này có thể gộp thành 1 update.
2. **`failed_login_count` (DB) không reset khi khóa**: quyết định khóa dựa trên bộ đếm **Redis (email+IP)**; cột DB chỉ để lưu vết (audit) và được reset khi login thành công. Không ảnh hưởng logic.
3. **DoS khóa tài khoản**: `locked_until` ở cấp User (toàn cục) — một IP đủ 5 lần sai sẽ khóa user ở mọi IP. Đây là **thiết kế đã chốt** trong login.md/Decision-004 (giảm thiểu bằng đếm theo email+IP), không phải lỗi implement.
4. **Rate limit fixed-window** (`INCR` + `EXPIRE` lần đầu): nếu process chết đúng giữa `INCR` và `EXPIRE`, key có thể thiếu TTL (xác suất rất thấp). Đủ cho MVP; sprint sau có thể chuyển sang Lua script/`SET NX PX` để nguyên tử tuyệt đối.
5. **[Khuyến nghị triển khai] `trust proxy`**: sau Nginx, `@Ip()` trả IP proxy nếu chưa cấu hình `trust proxy` → rate limit/lockout theo IP sẽ gộp chung. Cần bật `trust proxy` phù hợp ở tầng triển khai (không sửa trong module Login vì phụ thuộc hạ tầng).
6. **Redis down = login fail-closed**: khi Redis lỗi ở bước rate limit, login trả `500` (an toàn nhưng ảnh hưởng khả dụng). Chính sách fail-open/closed nên do Product quyết định — giữ nguyên hành vi hiện tại.

---

## 4. Files liên quan review

**Sửa trong lần review này (fix + đồng bộ test):**
- `apps/backend/src/modules/auth/services/refresh-token.service.ts`
- `apps/backend/src/modules/auth/services/login.service.ts`
- `apps/backend/src/modules/auth/services/login.service.spec.ts`

**Đã kiểm tra (không đổi):** `login.controller.ts`, `dto/login-request.dto.ts`, `dto/login-response.dto.ts`, `services/token.service.ts`, `services/user.service.ts`, `services/rate-limit.service.ts`, `exceptions/*`, `common/utils/mask-email.util.ts`, `auth.module.ts`.

---

## 5. Kết quả build & test (sau khi sửa)

```
> nest build                     ✅ không lỗi TypeScript

> jest --passWithNoTests
PASS src/modules/auth/services/login.service.spec.ts
... (7 suites)
Test Suites: 7 passed, 7 total
Tests:       21 todo, 13 passed, 34 total
```

Login 6/6 case bắt buộc xanh: success · wrong password · email not found · locked · disabled · rate limit (+ assert cache Redis gọi sau commit).

---

> **Kết luận:** Implementation Login **đạt** các tiêu chí kiến trúc/bảo mật/nghiệp vụ. Một lỗi thực chất (Redis I/O trong transaction) đã được sửa; các điểm còn lại là ghi chú/khuyến nghị theo đúng thiết kế đã chốt, không nằm trong phạm vi phải sửa. Không mở rộng ngoài Login.
