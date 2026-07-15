# REVIEW.md — Technical Architect Review

> Vai trò: Technical Architect
> Phạm vi review: Toàn bộ tài liệu gốc `.claude/CLAUDE.md` (Source of Truth)
> Ngày review: 2026-07-14
> Trạng thái codebase: **Greenfield** — repo hiện chỉ có `.claude/CLAUDE.md`, chưa có source code, migration, hay tài liệu module nào.
> Mục đích: Phát hiện thiếu sót về requirement, kiến trúc, module, entity, API, business rule, và rủi ro bảo mật/mở rộng **trước khi** implement Sprint 1.

---

> ## 🔄 CẬP NHẬT SAU ADR — 2026-07-14
>
> `architecture/ADR.md` (ADR-001 → ADR-020, ACCEPTED) đã giải quyết một phần các phát hiện trong bản review này. CLAUDE.md đã được đồng bộ theo ADR.
>
> Trạng thái từng mục được đánh dấu **inline** bên dưới với các nhãn:
> - ✅ **ĐÃ XỬ LÝ** — đã có quyết định trong ADR.
> - 🟡 **XỬ LÝ MỘT PHẦN** — ADR chốt một phần, phần còn lại vẫn mở.
> - ⚪ **KHÔNG ÁP DỤNG / HOÃN** — ADR quyết định khác đề xuất, hoặc cố ý để ngoài phạm vi MVP.
> - 🔴 **CÒN MỞ** — ADR chưa đề cập, cần chốt ở sprint/tài liệu module.
>
> Bảng tổng hợp disposition đầy đủ nằm ở **Mục 10** (cuối tài liệu).

---

## 0. Tóm tắt điều hành (Executive Summary)

Tài liệu CLAUDE.md có nền tảng tốt: đã xác định rõ multi-tenant, clean architecture, tech stack, coding principles và Definition of Done. Tuy nhiên **còn nhiều khoảng trống nghiêm trọng cần chốt trước khi code**, đặc biệt ở các nhóm:

| Nhóm vấn đề | Mức độ | Ảnh hưởng |
|---|---|---|
| Xung đột định danh dự án (HR vs CN Management) | 🔴 Cao | Nhầm lẫn phạm vi nghiệp vụ |
| Chiến lược cô lập dữ liệu multi-tenant chưa định nghĩa | 🔴 Cao | Rủi ro rò rỉ dữ liệu chéo tenant |
| Mô hình RBAC (Sprint 1) chưa có entity/quan hệ cụ thể | 🔴 Cao | Không thể implement đúng Sprint 1 |
| Thiếu định nghĩa Entity & quan hệ toàn hệ thống | 🔴 Cao | Không có cơ sở thiết kế DB |
| Thiếu chiến lược tích hợp Platform (OAuth/token/sync) | 🟠 Trung bình | Ảnh hưởng thiết kế cốt lõi về sau |
| Thiếu chuẩn hoá lỗi, phân trang, versioning, audit | 🟠 Trung bình | Nợ kỹ thuật, phá vỡ "response thống nhất" |
| Thiếu yêu cầu phi chức năng (NFR), testing, observability | 🟠 Trung bình | Không đo được "Done" thực chất |

**Khuyến nghị:** Chốt các mục 🔴 trong phần 1–4 trước khi bắt đầu code Sprint 1.

---

## 1. Requirement còn thiếu

### 1.1. 🔴 Xung đột định danh & phạm vi sản phẩm
> ✅ **ĐÃ XỬ LÝ (ADR-001):** Tên chính thức = **NCMedia Management Platform**; đây là hệ quản lý vận hành TMĐT đa nền tảng, HR chỉ là 1 module. CLAUDE.md Mục 1 & 2 đã cập nhật.
- Tiêu đề tài liệu là **"CN Management SaaS"** (dòng 3) nhưng `Project Name` lại là **"HR Management SaaS"** (dòng 17), và toàn bộ overview mô tả nghiệp vụ **quản lý bán hàng đa nền tảng TMĐT** (shop, order, fulfillment, doanh thu).
- Đây **không phải** một hệ HR thuần túy (không có chấm công, lương, hợp đồng, nghỉ phép...). Nó là **hệ quản lý vận hành bán hàng đa kênh có phân quyền nhân sự**.
- **Cần chốt:** Tên sản phẩm chính thức và một câu định nghĩa phạm vi (scope statement) duy nhất, nhất quán trong toàn tài liệu.

### 1.2. 🔴 Thiếu định nghĩa nghiệp vụ cốt lõi
> 🟡 **XỬ LÝ MỘT PHẦN:** Order nhập thủ công ở sprint đầu, sync sau (ADR-012); Fulfillment = User có Role Fulfillment (ADR-013); Profit tính runtime từ Revenue/Cost/Shipping/Platform/Other Fee (ADR-014); ShopAccount thuộc Organization, Platform là global (ADR-011). **Còn mở:** vòng đời trạng thái Order (state machine), định nghĩa chi tiết ShopAccount ↔ Employee, xử lý refund/hủy đơn — sẽ chốt trong tài liệu module tương ứng.
Các khái niệm trung tâm được nhắc tên nhưng **chưa được định nghĩa**:
- **Order**: nguồn đơn đến từ đâu? Nhập tay hay đồng bộ từ platform? Vòng đời trạng thái (state machine) gồm những trạng thái nào?
- **Fulfillment**: quy trình gồm những bước gì? Ai chuyển trạng thái nào? Có tách khỏi Order không?
- **Shop Account**: là "gian hàng trên platform" hay "tài khoản đăng nhập platform của nhân viên"? Quan hệ với Employee và Platform ra sao?
- **Doanh thu / Lợi nhuận**: công thức tính? Lợi nhuận = Doanh thu − (giá vốn + phí platform + phí ship + phí quảng cáo?) — chưa định nghĩa các cấu phần chi phí.

### 1.3. 🟠 Thiếu yêu cầu phi chức năng (NFR)
> 🔴 **CÒN MỞ:** ADR chưa đề cập NFR (hiệu năng, backup/RTO/RPO, i18n/timezone/đa tiền tệ). Lưu ý ADR-003 có bảng Global `Currency` → đã có chỗ cho đa tiền tệ, nhưng chính sách quy đổi/timezone vẫn cần chốt. Đề nghị bổ sung ADR hoặc tài liệu NFR riêng.
- Không có mục tiêu về hiệu năng (RPS, p95 latency), quy mô dữ liệu (số org, số order/ngày), SLA/uptime.
- Không có yêu cầu về sao lưu (backup), khôi phục (RTO/RPO), lưu trữ (data retention).
- Không có yêu cầu về i18n/timezone/tiền tệ — hệ đa nền tảng quốc tế **bắt buộc** phải xử lý đa tiền tệ (USD/EUR...) và timezone.

### 1.4. 🟠 Thiếu yêu cầu vận hành & tuân thủ
> 🔴 **CÒN MỞ:** ADR chưa đề cập audit log, GDPR/PII, môi trường dev/staging/prod, CI/CD. `created_by/updated_by/deleted_at` đã có ở tầng DB (ADR-015) nhưng chưa có module Audit Log. Đề nghị bổ sung ADR vận hành/tuân thủ.
- Không có chính sách audit log (ai làm gì, khi nào) — mâu thuẫn với việc DB đã yêu cầu `created_by`/`updated_by`.
- Không có yêu cầu về GDPR/PII (dữ liệu nhân viên, dữ liệu khách hàng trong order là dữ liệu cá nhân).
- Không có định nghĩa môi trường (dev/staging/prod), CI/CD, chiến lược migration khi lên production.

---

## 2. Điểm kiến trúc chưa hợp lý

### 2.1. 🔴 Chưa chọn chiến lược cô lập dữ liệu Multi-Tenant
> 🟡 **XỬ LÝ MỘT PHẦN (ADR-004):** Đã chốt — **KHÔNG dùng RLS**; enforce tại **tầng Backend**, mọi Repository phải nhận `organizationId`, cấm query khi thiếu `organizationId`. Đây là lựa chọn **khác** với đề xuất RLS/middleware của review. ⚠️ **Rủi ro tồn dư:** cơ chế này phụ thuộc kỷ luật lập trình viên (dễ quên truyền `organizationId`). **Khuyến nghị bổ sung:** một Base Repository/Guard bắt buộc tenant context + test cô lập tenant để bù rủi ro — chưa nằm trong ADR.
Tài liệu yêu cầu `organization_id` trên mọi bảng nghiệp vụ (tốt), nhưng **chưa quyết định cơ chế thực thi (enforcement)**:
- **Shared DB, shared schema + `organization_id`** (đang ngầm định) → **rủi ro lớn nhất là quên `WHERE organization_id`**. Cần bắt buộc một trong:
  - PostgreSQL **Row-Level Security (RLS)**, hoặc
  - Prisma middleware/extension tự động inject `organization_id`, hoặc
  - Repository base class bắt buộc tenant scope.
- **Cần chốt:** Cơ chế enforcement + cách truyền tenant context (từ JWT claim → request scope → repository). Không được để lập trình viên tự nhớ.

### 2.2. 🟠 "Modular Monolith" chưa có ranh giới module (boundaries)
> 🔴 **CÒN MỞ:** ADR-002 xác nhận Modular Monolith + "có thể tách service sau" nhưng chưa quy định ranh giới/nguyên tắc giao tiếp giữa module (facade/port, chống phụ thuộc vòng). Cần chốt trước khi module bắt đầu phụ thuộc lẫn nhau (Order ↔ Employee ↔ Shop).
- Chưa quy định module giao tiếp với nhau thế nào: gọi service trực tiếp, qua interface/port, hay qua domain events?
- Không có nguyên tắc chống phụ thuộc vòng (ví dụ Order phụ thuộc Employee nhưng Employee không được phụ thuộc ngược Order).
- **Đề xuất:** Định nghĩa mỗi module expose một *public interface (facade/port)*; cấm import trực tiếp repository/entity của module khác.

### 2.3. 🟠 Mâu thuẫn thuật ngữ Clean Architecture vs cấu trúc thư mục
> ✅ **ĐÃ XỬ LÝ (ADR-002):** Chốt là **"Clean Architecture (Pragmatic)"** + DDD Inspired + Repository Pattern (ADR-016) — tức layered thực dụng, không yêu cầu full port/adapter tách domain entity khỏi ORM. Thuật ngữ đã rõ ràng, không còn cargo-cult.
- Tài liệu tuyên bố "Clean Architecture" + "DDD" nhưng folder structure lại theo kiểu layered truyền thống (controller/service/repository) và gọi là "entity" trong khi thực chất là ORM model của Prisma.
- Trong Clean Architecture thật, **domain entity phải độc lập với framework/ORM**. Cần làm rõ: dùng "Clean Architecture nhẹ" (pragmatic layered) hay full port/adapter? Tránh cargo-cult.

### 2.4. 🟠 Thiếu tầng cross-cutting trong cấu trúc
> 🔴 **CÒN MỞ:** ADR chưa bổ sung `guards/interceptors/filters/decorators/jobs`. Tuy nhiên các thành phần này là bắt buộc để thực thi response chuẩn (Mục 12), error handling (Mục 14) và tenant enforcement (ADR-004). Đề nghị bổ sung vào folder structure khi implement module Auth.
Folder structure backend thiếu chỗ cho: `guards`, `interceptors`, `middlewares`, `filters` (exception filter toàn cục), `decorators`, `jobs/queue` (BullMQ), `events`. Đây là các thành phần bắt buộc để thực thi response chuẩn, error handling, tenant scope, rate limit.

### 2.5. 🟢 Thiếu chiến lược cache dù đã có Redis
> 🔴 **CÒN MỞ:** ADR-006 vẫn chỉ dùng Redis cho Refresh Token. Vai trò Redis cho cache/rate-limit/queue chưa được định nghĩa — để mở cho sprint sau (Notification, Platform sync).
Redis mới chỉ dùng cho refresh token. Cần định vị rõ vai trò Redis: cache, session, rate-limit store, hay message/queue broker (BullMQ) — ảnh hưởng thiết kế module Notification và đồng bộ Platform.

---

## 3. Module còn thiếu

> **Trạng thái theo ADR:**
> - ✅ **User tách khỏi Employee** — chốt (ADR-007). Quan hệ Organization → User → Employee.
> - ⚪ **Membership (User↔Org↔Role)** — **KHÔNG áp dụng cho MVP** (ADR-008): 1 User chỉ thuộc 1 Organization, không cần bảng nối multi-org. Role gắn vào User trong phạm vi org.
> - ⚪ **Fulfillment (module/entity riêng)** — **KHÔNG áp dụng** (ADR-013): Fulfillment là User có Role Fulfillment, Order lưu `fulfillment_user_id`.
> - 🟡 **Integration/Sync (Platform Connector)** — **HOÃN** (ADR-012): sprint đầu nhập Order thủ công, sync API phát triển sau.
> - 🔴 **Audit Log, File/Media Storage, Billing/Subscription, Health/Ops** — ADR chưa đề cập, còn mở (Billing coi như ngoài phạm vi MVP cho tới khi có ADR).
> - 🔴 **Bootstrap order (seed Role/Permission trước Admin)** — vẫn cần làm rõ luồng seed trong tài liệu module Auth (Sprint 1 scope có "Seed dữ liệu mặc định").

Danh sách 12 module hiện tại thiếu các module nền tảng sau:

| Module đề xuất | Lý do | Mức độ |
|---|---|---|
| **Tenant/Organization Context & Membership** | Cần bảng nối User ↔ Organization ↔ Role (một user có thể thuộc nhiều org?) — hiện chưa rõ | 🔴 Cao |
| **User/Account (tách khỏi Employee)** | "Đăng nhập" là khái niệm Auth/User, khác với "Employee" (hồ sơ nhân sự). Gộp chung sẽ vướng khi Admin không phải Employee | 🔴 Cao |
| **Audit Log** | DB đã có `created_by/updated_by`; cần module ghi vết hành động cho bảo mật & tuân thủ | 🟠 TB |
| **Fulfillment** (module riêng) | Đang bị coi là thuộc tính của Order, nhưng có role riêng (Fulfillment) và vòng đời riêng | 🟠 TB |
| **File/Media Storage** | Order/Shop/Employee cần upload ảnh, chứng từ, avatar — chưa có | 🟠 TB |
| **Integration/Sync (Platform Connector)** | Đồng bộ order/token từ TikTok/eBay/Amazon... là nghiệp vụ lớn, không phải chỉ 1 bảng "Platform" | 🟠 TB |
| **Billing/Subscription** | Đây là "SaaS" → cần gói cước, giới hạn theo plan (số nhân viên, số shop). Nếu ngoài scope MVP thì cần ghi rõ | 🟢 Thấp |
| **Health/Ops (health check, metrics)** | Phục vụ vận hành production | 🟢 Thấp |

**Lưu ý về Sprint 1:** Scope Sprint 1 là "RBAC Foundation + Auth + Organization + Seed Admin". Nhưng thứ tự module (Auth → Org → Role → Permission) **ngược logic khởi tạo**: muốn đăng ký Organization và tạo Admin đầu tiên thì Role/Permission phải được seed **trước**. Cần làm rõ luồng bootstrap.

---

## 4. Entity còn thiếu

> **Trạng thái theo ADR — 3 câu hỏi kiến trúc đã được trả lời:**
> 1. ✅ Role **Dynamic**, Admin tạo thêm được (ADR-009). Default: Admin, Employee, Fulfillment.
> 2. ✅ Permission **chỉ gán qua Role**, không gán trực tiếp User (ADR-010); dạng `resource.action`.
> 3. ✅ User **single-org** (ADR-008) → `User` tenant-scoped, **không cần** entity `Membership`.
>
> ✅ **Mâu thuẫn `Platform` vs `organization_id` (4.3) đã xử lý (ADR-003, ADR-011):** Platform/Country/Currency là bảng **Global**, không mang `organization_id`. CLAUDE.md Mục 5 & 11 đã sửa "không có ngoại lệ".
>
> 🔴 **Còn mở:** cấu trúc chi tiết `OrderItem`, `Notification`, `Setting`, `AuditLog`, và `RefreshToken` (dù lưu Redis) chưa được đặc tả — sẽ chốt trong `database.md` của từng module.

Tài liệu **chưa có mô hình dữ liệu (data model / ERD) nào**. Đây là thiếu sót lớn nhất về mặt thiết kế. Dựa trên nghiệp vụ, các entity tối thiểu cần định nghĩa:

### 4.1. Nhóm Auth & RBAC (cần cho Sprint 1) 🔴
- `Organization` (tenant)
- `User` (thông tin đăng nhập: email, password_hash, status)
- `Membership` / `OrganizationUser` (User ↔ Organization, giữ role trong org)
- `Role` (Admin, Employee, Fulfillment... — scoped theo org hay global?)
- `Permission` (định danh quyền, ví dụ `order.read`, `shop.manage`)
- `RolePermission` (bảng nối Role ↔ Permission)
- `RefreshToken` / session (dù lưu Redis vẫn cần định nghĩa cấu trúc)

**Câu hỏi kiến trúc cần chốt:**
1. Role là **system role cố định** hay **cho phép Admin tạo role tùy biến**? (Ảnh hưởng lớn tới RBAC).
2. Permission gán trực tiếp cho User được không, hay chỉ qua Role?
3. Một User có thuộc nhiều Organization không? (Quyết định `User` là global hay tenant-scoped).

### 4.2. Nhóm nghiệp vụ (Sprint sau, nhưng cần thiết kế trước) 🟠
- `Employee` (hồ sơ nhân sự, liên kết `User`)
- `Platform` (TikTok/eBay/Amazon... — là danh mục hệ thống, **không có `organization_id`**? Cần làm rõ vì mục 5 nói "không có ngoại lệ")
- `ShopAccount` (gian hàng, thuộc Platform + Organization + Employee phụ trách; chứa credential/token)
- `Order` (đơn hàng, liên kết ShopAccount, có state)
- `OrderItem` (dòng sản phẩm trong đơn — thiếu hoàn toàn)
- `Fulfillment` (trạng thái xử lý đơn, người xử lý)
- `Notification`
- `Setting` (theo org / theo user)
- `AuditLog`

### 4.3. 🔴 Mâu thuẫn: `Platform` và quy tắc `organization_id`
Mục 5 nói *"Mọi bảng nghiệp vụ phải có `organization_id`, không có ngoại lệ"*. Nhưng `Platform` (TikTok, eBay...) là **danh mục dùng chung toàn hệ thống**, không nên gắn tenant. Cần phân loại rõ **bảng danh mục hệ thống (global/reference table)** vs **bảng nghiệp vụ (tenant-scoped)** để tránh mâu thuẫn.

---

## 5. API còn thiếu

> 🔴 **CÒN MỞ:** ADR không đặc tả endpoint hay quy ước API (pagination, `errors[]`, idempotency, request-id, versioning policy). Đây là việc của `api.md` từng module theo workflow ADR-019 (Requirement → Business Rule → Database → **API** → ...). Cần đặc tả API Sprint 1 (auth/register, login, refresh, logout, me, roles, permissions) + chuẩn pagination/error trước khi code Backend.

Tài liệu mới định nghĩa format response và version, **chưa liệt kê endpoint nào**. Với Sprint 1, tối thiểu cần đặc tả:

### 5.1. API Sprint 1 (bắt buộc đặc tả trước khi code)
- `POST /api/v1/auth/register` — đăng ký Organization + tạo Admin đầu tiên
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET  /api/v1/auth/me` — thông tin user + quyền hiện tại (thiếu — FE cần để render UI theo quyền)
- `GET  /api/v1/roles`, `GET /api/v1/permissions` — phục vụ RBAC

### 5.2. Quy ước API còn thiếu (áp dụng toàn hệ thống) 🟠
Response chuẩn hiện tại **chưa bao phủ**:
- **Phân trang (pagination)**: chuẩn cho list (page/limit/cursor?), và cấu trúc `meta` (total, page...). Order/Report sẽ trả list lớn → bắt buộc.
- **Lọc / sắp xếp / tìm kiếm**: quy ước query param chung.
- **Error response chi tiết**: format hiện chỉ có `code/message`, thiếu `errors[]` cho validation từng field.
- **Idempotency**: cho các thao tác tạo đơn / thanh toán (idempotency key).
- **Rate limit headers**, **request ID / trace ID** (bắt buộc cho observability & hỗ trợ).
- **Versioning policy**: chỉ ghi `/api/v1`; chưa có chính sách deprecate.

---

## 6. Business Rule còn thiếu

> **Trạng thái theo ADR:**
> - 🟡 **Auth/RBAC (6.1):** Token lifetime đã chốt (ADR-006: access 15', refresh 7 ngày). **Còn mở:** password policy, khóa tài khoản sau N lần sai, email unique global hay theo org, rotation/revoke refresh token, quy tắc "Admin cuối cùng".
> - 🟡 **Nghiệp vụ (6.2):** Profit = runtime từ 5 cấu phần phí (ADR-014); Order nhập tay (ADR-012); soft delete (ADR-015). **Còn mở:** Order state machine, quy tắc refund/hủy, hành vi unique khi soft-delete.
> - 🟡 **Ownership/data scope (6.3):** ADR-004 mới enforce ở mức **Organization** (org-level). **Còn mở:** phân quyền **row-level** trong org (Employee chỉ thấy Order/Shop của mình) — RBAC theo Permission (ADR-010) cần bổ sung rule ownership.

Hiện gần như **chưa có business rule cụ thể nào**. Các rule tối thiểu cần định nghĩa:

### 6.1. Auth & RBAC (Sprint 1) 🔴
- Chính sách mật khẩu (độ dài, độ phức tạp), khóa tài khoản sau N lần sai, thời hạn access/refresh token.
- Quy tắc "Admin đầu tiên": ai được tạo, có thể có nhiều Admin không, có thể xóa Admin cuối cùng không?
- Ma trận phân quyền (permission matrix) rõ ràng: role nào làm được action nào trên resource nào.
- Refresh token rotation & thu hồi (revoke) khi logout / đổi mật khẩu / nghi ngờ lộ.
- Uniqueness của email: global hay theo từng Organization?

### 6.2. Nghiệp vụ (Sprint sau) 🟠
- **Order state machine**: các trạng thái hợp lệ và chuyển tiếp được phép; ai được chuyển.
- Quy tắc gán Order cho Fulfillment; một order gán cho nhiều người?
- Quy tắc tính doanh thu/lợi nhuận (định nghĩa công thức, xử lý hoàn/hủy đơn, refund).
- Ràng buộc ShopAccount ↔ Employee: một employee quản nhiều shop? một shop nhiều người?
- Soft-delete: DB có `deleted_at` → cần rule về hành vi khi bản ghi bị soft-delete (còn tính vào report? unique constraint xử lý sao?).

### 6.3. 🟠 Mâu thuẫn quyền hạn cần giải quyết
- Employee "Quản lý Order của mình" vs Admin "Quản lý Order" vs Fulfillment "được gán Order" → cần định nghĩa rõ **ownership** và **data scope** (row-level: employee chỉ thấy order thuộc shop mình).

---

## 7. Rủi ro Bảo mật & Khả năng mở rộng

> **Trạng thái theo ADR:**
> - 🟡 **Rò rỉ chéo tenant:** giảm nhẹ bởi ADR-004 (org-level enforcement) nhưng phụ thuộc kỷ luật — rủi ro tồn dư (xem 2.1).
> - 🟡 **JWT/refresh token:** lifetime + lưu Redis đã chốt (ADR-006). **Còn mở:** thuật toán ký (RS256/HS256), rotation, revoke list.
> - ⚪ **BOLA/IDOR:** org-level đã có (ADR-004); object-level ownership trong org **còn mở** (xem 6.3).
> - 🔴 **CÒN MỞ (chưa có ADR):** mã hóa credential Platform (ShopAccount), secrets management, PII/audit masking, ngưỡng rate-limit cho login. Đây là các rủi ro bảo mật quan trọng cần ADR bổ sung trước khi tới module ShopAccount/Order.

### 7.1. Bảo mật 🔴
| Rủi ro | Chi tiết | Khuyến nghị |
|---|---|---|
| **Rò rỉ dữ liệu chéo tenant** | Không có cơ chế enforce `organization_id` ở tầng thấp | Bắt buộc RLS hoặc Prisma tenant-guard middleware + test cô lập tenant |
| **Lưu credential Platform** | ShopAccount chứa token/API key của TikTok/eBay... — dữ liệu cực nhạy cảm | Mã hóa at-rest (KMS/column encryption), không log, không trả về API |
| **Broken Object Level Authorization (BOLA/IDOR)** | UUID không đủ để chống truy cập trái phép; cần check ownership | Authorization guard kiểm tra org + ownership trên mọi resource theo id |
| **JWT & refresh token** | Chưa định nghĩa thuật toán ký (RS256/HS256), rotation, revoke list | Chốt chiến lược token + blacklist trong Redis |
| **Secrets management** | Chưa có quy định về .env / vault / rotation secret | Định nghĩa nơi lưu secret cho prod (không hardcode, mâu thuẫn mục 18) |
| **PII & audit** | Dữ liệu nhân viên + khách hàng là PII, chưa có audit/masking | Thêm module Audit Log + policy che dữ liệu nhạy cảm trong log |
| **Rate limit** | Được nhắc nhưng chưa định nghĩa ngưỡng, đặc biệt cho login (chống brute-force) | Rate limit riêng cho auth endpoint |

### 7.2. Khả năng mở rộng 🟠
> 🟡 **Theo ADR:** Monolith giữ nguyên, tách service sau (ADR-002); Platform sync hoãn (ADR-012); Currency global có sẵn cho đa tiền tệ (ADR-003). **Còn mở:** chiến lược index/partition cho Order, pre-aggregation cho Report, chuẩn timezone (UTC), hàng đợi cho sync.
| Rủi ro | Chi tiết | Khuyến nghị |
|---|---|---|
| **Đồng bộ đa Platform** | Mỗi platform có API/rate-limit/webhook khác nhau; sync đồng bộ sẽ nghẽn | Thiết kế Connector pattern + hàng đợi (BullMQ/Redis) + webhook ingest; tách khỏi request cycle |
| **Bảng Order tăng trưởng lớn** | Order/OrderItem là bảng nóng, sẽ phình theo tenant | Chuẩn bị index theo `(organization_id, ...)`, cân nhắc partition theo thời gian/tenant |
| **Report nặng** | Thống kê doanh thu/lợi nhuận real-time trên bảng lớn sẽ chậm | Cân nhắc read-model/materialized view/pre-aggregation |
| **Monolith → giới hạn** | Modular monolith tốt cho MVP nhưng cần ranh giới rõ để tách service sau | Giữ module boundary sạch (mục 2.2) ngay từ đầu |
| **Timezone/tiền tệ** | Đa quốc gia nhưng chưa chuẩn hóa | Lưu UTC + currency code (ISO 4217), quy đổi ở tầng hiển thị/report |

### 7.3. Vận hành / Observability 🟢
> 🔴 **CÒN MỞ:** ADR chưa đề cập observability, migration an toàn, ngưỡng test coverage. Để mở cho tài liệu vận hành sau.
- Thiếu logging tập trung, metrics, tracing, health check, alerting.
- Thiếu chiến lược migration an toàn (zero-downtime) và rollback.
- Thiếu định nghĩa test: unit/integration/e2e coverage tối thiểu (DoD nói "Unit Test" nhưng không có ngưỡng).

---

## 8. Khuyến nghị hành động trước khi code Sprint 1

Theo thứ tự ưu tiên (đã cập nhật trạng thái sau ADR):

1. ✅ **Chốt tên & phạm vi sản phẩm** — XONG (ADR-001).
2. ✅ **Chốt mô hình RBAC** (Role động, Permission qua Role, User single-org) — XONG (ADR-008/009/010).
3. ✅ **Chốt cơ chế enforce multi-tenant** — XONG (ADR-004, backend-layer, không RLS). ⚠️ còn khuyến nghị Base Repository/Guard bù rủi ro kỷ luật.
4. 🟡 **ERD tối thiểu Sprint 1** — quan hệ đã rõ (Organization→User→Employee; Role/Permission qua RolePermission; không cần Membership). **Còn lại:** vẽ ERD chính thức + cấu trúc RefreshToken trong `database.md`.
5. 🔴 **Đặc tả API Sprint 1 chi tiết** — CÒN MỞ (`api.md` module Auth).
6. 🟡 **Business rules Auth/RBAC** — token lifetime XONG (ADR-006); password policy / bootstrap Admin / email uniqueness CÒN MỞ.
7. ✅ **Phân loại bảng global vs tenant-scoped** — XONG (ADR-003, ADR-011).
8. 🔴 **Bổ sung tài liệu module `docs/`** cho Auth — CÒN MỞ (bước tiếp theo trước khi code).

---

## 9. Điểm đã tốt (ghi nhận)

- Đã xác định rõ multi-tenant là bắt buộc và yêu cầu `organization_id`.
- Tech stack hiện đại, nhất quán, phù hợp bài toán.
- Có coding principles, folder structure, và Definition of Done rõ ràng.
- Có nguyên tắc tài liệu hóa module (`docs/` per module) — cần thực thi nghiêm.
- Quy tắc audit cơ bản (`created_by/updated_by/deleted_at`) đã có sẵn ở tầng DB.

---

> **Kết luận:** Tài liệu đủ tốt làm khung định hướng, nhưng **chưa đủ để implement Sprint 1 một cách an toàn**. Cần bổ sung các quyết định 🔴 ở phần 8 (đặc biệt: RBAC model, tenant enforcement, ERD, API spec) trước khi viết dòng code đầu tiên.
>
> Chờ Product Owner review các câu hỏi kiến trúc đã nêu. Tôi **không** chỉnh sửa CLAUDE.md và **không** sinh code cho đến khi được duyệt.

---

## 10. Bảng tổng hợp Disposition (sau ADR — 2026-07-14)

| # Mục review | Vấn đề | Trạng thái | Căn cứ / Ghi chú |
|---|---|---|---|
| 1.1 | Xung đột định danh HR vs sản phẩm | ✅ Đã xử lý | ADR-001 → NCMedia Management Platform |
| 1.2 | Định nghĩa nghiệp vụ cốt lõi | 🟡 Một phần | ADR-011/012/013/014; state machine còn mở |
| 1.3 | Yêu cầu phi chức năng (NFR) | 🔴 Còn mở | ADR chưa đề cập |
| 1.4 | Vận hành & tuân thủ (audit/GDPR/env) | 🔴 Còn mở | ADR chưa đề cập |
| 2.1 | Cơ chế enforce multi-tenant | 🟡 Một phần | ADR-004 (backend-layer, không RLS); còn rủi ro kỷ luật |
| 2.2 | Ranh giới module (boundaries) | 🔴 Còn mở | ADR-002 xác nhận monolith, chưa có boundary rule |
| 2.3 | Thuật ngữ Clean Architecture | ✅ Đã xử lý | ADR-002 "Pragmatic" + ADR-016 |
| 2.4 | Tầng cross-cutting trong folder | 🔴 Còn mở | Bổ sung khi implement Auth |
| 2.5 | Chiến lược cache Redis | 🔴 Còn mở | ADR-006 chỉ dùng cho refresh token |
| 3 | Module còn thiếu | 🟡 Một phần | User tách (007); Membership/Fulfillment không áp dụng (008/013); Sync hoãn (012); Audit/File/Billing/Ops còn mở |
| 4.1 | Entity Auth/RBAC + 3 câu hỏi | ✅ Đã xử lý | ADR-008/009/010; không cần Membership |
| 4.2 | Entity nghiệp vụ | 🟡 Một phần | Platform/Order/Fulfillment/Profit chốt; OrderItem/Notification/Setting/AuditLog còn mở |
| 4.3 | Mâu thuẫn Platform vs organization_id | ✅ Đã xử lý | ADR-003/011 (bảng Global) |
| 5.1 | API endpoint Sprint 1 | 🔴 Còn mở | `api.md` module Auth |
| 5.2 | Quy ước API (pagination/errors/idempotency) | 🔴 Còn mở | Chưa có ADR |
| 6.1 | Business rule Auth/RBAC | 🟡 Một phần | Token lifetime chốt (006); password policy còn mở |
| 6.2 | Business rule nghiệp vụ | 🟡 Một phần | Profit/Order/soft-delete chốt; state machine còn mở |
| 6.3 | Ownership / data scope | 🟡 Một phần | Org-level (004); row-level còn mở |
| 7.1 | Rủi ro bảo mật | 🟡 Một phần | Tenant/JWT giảm nhẹ; credential Platform/secrets/PII/rate-limit còn mở |
| 7.2 | Khả năng mở rộng | 🟡 Một phần | Monolith/sync/currency chốt; index/partition/report còn mở |
| 7.3 | Vận hành / Observability | 🔴 Còn mở | Chưa có ADR |

**Tổng kết:** 4 mục ✅ đã xử lý trọn vẹn, 9 mục 🟡 xử lý một phần, 8 mục 🔴 còn mở. Các mục 🔴 ưu tiên trước khi code Sprint 1: **5.1 (API Auth)**, **6.1 (password policy/bootstrap Admin)**, và **8 (tài liệu module Auth)**. Các mục bảo mật 🔴 ở 7.1 (credential Platform, secrets) cần ADR bổ sung trước module ShopAccount/Order — chưa gấp cho Sprint 1 nhưng phải chốt sớm.
