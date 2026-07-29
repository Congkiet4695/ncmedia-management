# Account Module — Business Analysis & Design (DRAFT)

> Module: **Account** (Shop/Platform Account — tương ứng **ShopAccount** trong ADR-011)
> Product: **NCMedia Management Platform** · Version: 0.1 · Status: **🟡 DRAFT — CHỜ PRODUCT OWNER REVIEW**
> Ngày: 2026-07-16
> Nguồn phân tích: `.claude/CLAUDE.md`, `architecture/ADR.md`, `docs/auth.md`, `docs/employee.md`,
> `docs/business/NcMedia.xlsx` (sheet **Account**), và 2 ảnh báo cáo **"Tổng quan account"**.
>
> ⚠️ **Tài liệu này KHÔNG chứa code.** Chỉ implement **sau khi PO ACCEPTED** (workflow ADR-019).
> Mọi điểm chưa chắc chắn được liệt kê tại [Mục 9 — Decisions cần PO chốt](#9-decisions-cần-po-chốt).
>
> **Ghi chú về sheet "Tổng":** Trong `NcMedia.xlsx` **không có sheet tên "Tổng"**. Phần "tổng hợp" liên quan
> đến Account nằm ở **báo cáo "Tổng quan account"** (2 ảnh) — được phân tích ở [Mục 1.4](#14-báo-cáo-tổng-quan-account) & [Mục 5](#5-frontend).

---

## 0. Bối cảnh nghiệp vụ (tóm tắt)

NCMedia vận hành bán hàng TMĐT đa nền tảng (TikTok Shop, Mercari, eBay, Amazon…). Để bán, đội ngũ
**Seller** dùng **tài khoản bán hàng trên sàn** ("Account"). Mỗi Account:

- Thuộc **một Platform** (Nền tảng) và được **một Seller quản lý**.
- Được nuôi/vận hành bằng **tool chống phát hiện** (Login tool, vd Hidemyacc) + **proxy** + **bộ định danh (INF/SSN)** + **email/2FA**.
- Có **vòng đời chết rất cao**: `Cấp → Hoạt động (Live) → Die trắng / Die → Về tiền`. Việc theo dõi
  trạng thái, lý do die, tuổi thọ, và **doanh thu/balance** theo từng Account là nghiệp vụ cốt lõi.

> Account = tài sản vận hành nhạy cảm: chứa **SSN, danh tính thật, mật khẩu, 2FA/TOTP secret**.
> ⇒ **Bảo mật (mã hoá + phân quyền + audit) là yêu cầu số 1** của module này.

### 0.1. Ánh xạ 40 cột sheet "Account" → nhóm dữ liệu

| # | Cột (sheet) | Nhóm | Ghi chú |
|---|---|---|---|
| 1 | Tên acc | Cơ bản | Tên hiển thị (required) |
| 2 | Login | Cơ bản | Tool đăng nhập/anti-detect (Hidemyacc…) |
| 3 | Nền tảng | Quan hệ | → Platform (Global — ADR-011) |
| 4 | Check trùng lặp | Cơ bản | "Không trùng lặp" — cờ/kết quả chống trùng |
| 5 | Seller quản lý | Quan hệ | → người quản lý (User/Employee) |
| 6 | Tình trạng | Vòng đời | Enum: Live / Die trắng / Die / … |
| 7 | Ngày cấp | Vòng đời | issued_at |
| 8 | Ngày hoạt động | Vòng đời | activated_at |
| 9 | Ngày die trắng | Vòng đời | died_blank_at |
| 10 | Ngày die | Vòng đời | died_at |
| 11 | Ngày về tiền | Vòng đời | money_returned_at |
| 12 | Lỗi die | Vòng đời | die_reason (text) |
| 13 | Proxy | 🔒 Nhạy cảm | proxy |
| 14 | INF | 🔒 Nhạy cảm (PII) | Chuỗi danh tính: SSN\|Họ\|Tên\|Địa chỉ\|Ngày sinh\|Phone |
| 15 | SSN | 🔒 Nhạy cảm (PII) | Số an sinh xã hội |
| 16 | Phone reg | 🔒 Nhạy cảm | Số điện thoại đăng ký |
| 17 | Gmail | 🔒 Nhạy cảm | Email tài khoản |
| 18 | Pass Gmail | 🔒 **Secret** | **Mã hoá bắt buộc** |
| 19 | Mail khôi phục | 🔒 Nhạy cảm | recovery email |
| 20 | 2FA Mail khôi phục | 🔒 **Secret** | 2FA/secret của mail khôi phục |
| 21 | Pass nền tảng | 🔒 **Secret** | **Mã hoá bắt buộc** |
| 22 | Docs | Cơ bản | Link Google Drive (giấy tờ) |
| 23 | 2fa nền tảng | 🔒 **Secret** | TOTP secret sàn — **mã hoá bắt buộc** |
| 24 | Ghi chú | Cơ bản | note |
| 25 | Ghi chú 2 | Cơ bản | note2 |
| 26 | Đơn hàng | 📊 Metric | Suy ra từ Order (chưa có module) |
| 27 | Hold | 📊 Metric | Tiền giữ |
| 28 | Net | 📊 Metric | |
| 29 | Tuổi thọ | 📊 Suy ra | died_at − issued_at (ngày) |
| 30 | Doanh thu theo Sheet | 📊 Metric (legacy) | Nguồn Google Sheet cũ |
| 31 | Đơn hàng hôm nay | 📊 Metric | |
| 32 | Tổng đơn 7 ngày qua | 📊 Metric | |
| 33 | VSV | 📊 Metric | (cần PO giải nghĩa) |
| 34 | Doanh thu theo Acc | 📊 Metric | Doanh thu tính theo Account |
| 35 | Tổng đã rút | 📊 Metric | total_withdrawn |
| 36 | Balance Die | 📊 Metric | Số dư khi die |
| 37 | Balance theo Acc | 📊 Metric | |
| 38 | Balance theo Sheet | 📊 Metric (legacy) | |
| 39 | Hành động với Balance | 📊 Metric | Rút/hold… |
| 40 | ID_Normalize | Cơ bản | Khoá chuẩn hoá (vd `TTS32-T3`) — phục vụ chống trùng |

> 📊 **Metric** (cột 26–39): **KHÔNG phải dữ liệu nhập tay của Account** — chúng là **kết quả tính/tổng hợp**
> từ **Order/giao dịch rút tiền** (module Order chưa có). Theo tinh thần **ADR-014** (Profit tính runtime),
> nhóm này nên **suy ra/derived**, không lưu cứng trên bảng `accounts`. Phạm vi MVP xem [Decision D-08](#9-decisions-cần-po-chốt).
> Các cột "theo Sheet" là di sản đối soát với Google Sheet cũ ⇒ **không đưa vào DB mới**.

### 1.4. Báo cáo "Tổng quan account"

2 ảnh báo cáo cho thấy các **báo cáo/tổng hợp** cần có (đối tượng dùng: Admin/Quản lý):

1. **Account theo Seller**: đếm số Account theo trạng thái `Live / Die trắng / Die` cho từng Seller (+ dòng Tổng). Kèm **biểu đồ cột chồng** (stacked bar) Live/Die trắng/Die theo Seller.
2. **Account theo Seller / Nền tảng**: đếm Live/Die trắng/Die theo (Seller × Platform).
3. **Doanh thu Account theo Seller / tháng (NO DIE)**: bảng doanh thu từng Account theo tháng (T5/T6/T7…), nhóm theo Seller, **loại account đã Die**.

> Đây là **Reporting/Overview** — phụ thuộc dữ liệu Order. Đề xuất tách thành phần Report (sau), MVP chỉ làm
> phần đếm trạng thái (không cần Order). Xem [Decision D-09](#9-decisions-cần-po-chốt).

---

## 1. Requirement

### 1.1. Mục tiêu

Quản lý toàn bộ vòng đời **Account bán hàng trên sàn** trong một Organization: tạo/nhập, phân công Seller,
theo dõi trạng thái & lý do die, lưu trữ **an toàn** thông tin đăng nhập/định danh, và cung cấp
**tổng quan** (đếm theo trạng thái/seller/nền tảng, doanh thu theo account khi có Order).

### 1.2. Phạm vi (đề xuất MVP)

**Trong phạm vi MVP:**
- CRUD Account (tenant-scoped, ADR-003/004).
- Gán **Platform** (Global) và **Seller quản lý**.
- Quản lý **vòng đời/trạng thái** + các mốc ngày (cấp/hoạt động/die trắng/die/về tiền) + lý do die + tuổi thọ (derived).
- Lưu **credentials/định danh** có **mã hoá at-rest** + **phân quyền xem** + **audit truy cập**.
- Filter/Search/Sort/Pagination; import? (xem D-11).
- Tổng quan cơ bản: **đếm Account theo trạng thái / seller / nền tảng** (không cần Order).

**Ngoài phạm vi MVP (đề xuất tách/sau):**
- Metric doanh thu/đơn/balance theo Account (phụ thuộc **Order** — module chưa có).
- Đồng bộ API sàn (TikTok…) — ADR-012 (Order nhập tay trước).
- Auto-login/khởi chạy tool, tự động điền 2FA.
- Report/Dashboard nâng cao (doanh thu theo tháng, biểu đồ) — thuộc module Report.

### 1.3. Actors

| Actor | Vai trò với Account |
|---|---|
| **Admin** | Toàn quyền: CRUD mọi Account trong Org, gán Seller, xem credentials, xem audit. |
| **Seller** (Employee role phù hợp) | Quản lý Account **được gán cho mình**: xem/cập nhật vận hành, xem credentials của account mình. (Quyền chi tiết — xem [Mục 6](#6-permission) & D-05/D-06) |
| **Manager/Viewer** (nếu có) | Xem tổng quan, **không** xem secret. |
| **Employee thường** | Không truy cập Account Management (giống ràng buộc Employee ↔ Profile). |

> Actor "Seller" cần được định nghĩa rõ (là Role động? Employee? User có role riêng?) — xem D-05.

---

## 2. Business Rule

> Ký hiệu nguồn: (Sheet) = suy ra từ dữ liệu Excel; (ADR-xxx) = ràng buộc kiến trúc; (PO?) = cần PO xác nhận.

**Định danh & Tenant**
- **BR-A01** Mỗi Account thuộc **đúng 1 Organization** (`organization_id`) — tenant isolation (ADR-003/004). Admin org A không thấy Account org B.
- **BR-A02** `Tên acc` **bắt buộc**. (Sheet)
- **BR-A03** Account gắn **đúng 1 Platform** (Global — ADR-011). (Sheet: Nền tảng) — nullable hay bắt buộc? (D-03)
- **BR-A04** `ID_Normalize` là **khoá chuẩn hoá** phục vụ chống trùng; đề xuất **unique theo (organization_id, id_normalize)** khi có giá trị. (Sheet: Check trùng lặp/ID_Normalize, D-04)

**Vòng đời & trạng thái**
- **BR-A05** `Tình trạng` là enum, tối thiểu: **LIVE, DIE_TRANG (Die trắng), DIE**; có thể thêm **NEW/PENDING (mới cấp, chưa hoạt động)**, **RETURNED (đã về tiền)**. Danh sách chính thức — D-02.
- **BR-A06** Các mốc ngày phải **hợp lệ theo thứ tự**: `Ngày cấp ≤ Ngày hoạt động ≤ Ngày die trắng/Ngày die ≤ Ngày về tiền` (bỏ qua giá trị null). (PO?)
- **BR-A07** `Die trắng` = account **chết trước khi phát sinh doanh thu**; `Die` = chết sau khi hoạt động. (Sheet/PO?)
- **BR-A08** `Tuổi thọ` (Tuổi thọ) **KHÔNG lưu cứng**, tính runtime = `(died_at − issued_at)` theo ngày (tinh thần ADR-014). (D-08)
- **BR-A09** Khi chuyển trạng thái sang DIE/DIE_TRANG, `Lỗi die` (die_reason) nên **bắt buộc** (khuyến nghị). (PO?)

**Bảo mật credentials (quan trọng nhất)**
- **BR-A10** Các trường **secret** (`Pass Gmail`, `Pass nền tảng`, `2fa nền tảng`, `2FA Mail khôi phục`) phải **mã hoá at-rest** bằng **mã hoá đối xứng có thể giải (AES-256-GCM)**, khoá lấy từ **ENV/KMS** — **KHÔNG hash** (vì cần lấy lại để đăng nhập), **KHÔNG lưu plaintext**. **Cần ADR mới về Secrets Encryption** (D-01).
- **BR-A11** `SSN`, `INF`, `Phone reg`, `Gmail`, `Mail khôi phục` là **PII nhạy cảm**: mã hoá hoặc mask; **mask trong log** (mở rộng ADR-024). (D-01)
- **BR-A12** API/response **mặc định KHÔNG trả secret**; chỉ trả qua **endpoint reveal riêng** có **permission đặc biệt** + **ghi audit** mỗi lần xem (giống mô hình mật khẩu Employee một-lần nhưng đây là dữ liệu cần xem lại nhiều lần → phải audit). (D-06)
- **BR-A13** Không log secret/PII (ADR-024 mở rộng): thêm redact cho các field secret.

**Phân công & quyền**
- **BR-A14** Mỗi Account có **0..1 Seller quản lý** (`seller_*_id`). (Sheet)
- **BR-A15** Seller chỉ thao tác Account **được gán cho mình** (row-level ownership) — trừ Admin. (D-05/D-06)
- **BR-A16** Seller **KHÔNG** được đổi `organization_id`, và (đề xuất) **không** tự đổi `Seller quản lý` sang người khác (chỉ Admin gán lại). (PO?)

**Chung (kế thừa convention)**
- **BR-A17** UUID PK, soft delete (`deleted_at`), cột audit (`created_at/updated_at/created_by/updated_by`), `organization_id` — ADR-005/015.
- **BR-A18** Metric (đơn/doanh thu/balance) **derived** từ Order/giao dịch; MVP có thể để trống/tách sau (D-08).

---

## 3. Database

> Tuân thủ ADR-005/015 & CLAUDE.md Mục 11. **Chưa sinh Prisma/migration** — chỉ thiết kế.
> Bảng nghiệp vụ tenant-scoped, soft delete, audit cols.

### 3.1. Enum đề xuất

```
AccountStatus = { NEW, LIVE, DIE_TRANG, DIE, RETURNED }   // chốt danh sách tại D-02
```

### 3.2. Bảng `accounts` (tenant-scoped)

| Cột | Kiểu | Ràng buộc | Nguồn |
|---|---|---|---|
| id | uuid | PK | ADR-005 |
| organization_id | uuid | FK → organizations, NOT NULL | ADR-004 |
| name | varchar(255) | NOT NULL | Tên acc |
| id_normalize | varchar(120) | NULL; unique `(organization_id, id_normalize)` khi có | ID_Normalize |
| platform_id | uuid | FK → platforms (Global), NULL/NOT NULL? (D-03) | Nền tảng |
| login_tool | varchar(100) | NULL | Login |
| seller_user_id *(hoặc employee_id)* | uuid | FK → users/employees, NULL (D-05) | Seller quản lý |
| status | AccountStatus | NOT NULL, default `NEW` | Tình trạng |
| issued_at | date | NULL | Ngày cấp |
| activated_at | date | NULL | Ngày hoạt động |
| died_blank_at | date | NULL | Ngày die trắng |
| died_at | date | NULL | Ngày die |
| money_returned_at | date | NULL | Ngày về tiền |
| die_reason | text | NULL | Lỗi die |
| hold_amount | decimal(15,2) | NOT NULL default 0, CHECK `>= 0` | Hold (D-13 — đã chốt) |
| net_amount | decimal(15,2) | NOT NULL default 0, CHECK `>= 0` | Net (D-13 — đã chốt) |
| paid_amount | decimal(15,2) | NOT NULL default 0, CHECK `>= 0` | Đã thanh toán/đã rút |
| proxy | varchar(255) | NULL (nhạy cảm) | Proxy |
| docs_url | varchar(1024) | NULL | Docs |
| note | text | NULL | Ghi chú |
| note2 | text | NULL | Ghi chú 2 |
| + audit cols | | `created_at/updated_at/deleted_at/created_by/updated_by` | ADR-015 |

> **Cập nhật 2026-07-29 (PO chốt D-13 một phần):** `Hold` / `Net` / `Paid` được **lưu trực tiếp trên
> `accounts`** (nhập tay / import Excel), **không** derived từ Order. Đây là **snapshot số dư sàn**,
> khác với Profit (vẫn tính runtime — ADR-014 không đổi). Migration:
> `20260729000000_account_add_amounts`. Đơn vị **USD**.

### 3.3. Credentials — 2 phương án lưu trữ (D-01/D-07)

Do khối lượng field nhạy cảm lớn, đề xuất **tách bảng `account_credentials`** (1-1 với `accounts`) để cô lập & phân quyền:

| Cột | Kiểu | Xử lý bảo mật |
|---|---|---|
| account_id | uuid | FK unique → accounts |
| inf | text | mã hoá (PII) |
| ssn | varchar | mã hoá (PII) |
| phone_reg | varchar | mã hoá/mask |
| gmail | citext | (nhạy cảm) |
| gmail_password | text | **AES-GCM** |
| recovery_mail | varchar | (nhạy cảm) |
| recovery_mail_2fa | text | **AES-GCM** |
| platform_password | text | **AES-GCM** |
| platform_2fa_secret | text | **AES-GCM** (TOTP) |

> Lưu trữ ciphertext + IV/tag (AES-GCM). Khoá KEK từ ENV/KMS (không hardcode — ADR-020). **Cần ADR-025 "Secrets Encryption at Rest"** (D-01).
> Nếu PO muốn đơn giản MVP: gộp vào `accounts` nhưng vẫn **bắt buộc mã hoá** các cột secret (D-07).

### 3.4. Chỉ mục
- `accounts(organization_id)`; `accounts(platform_id)`; `accounts(seller_user_id)`; `accounts(status)`.
- unique `(organization_id, id_normalize)` (partial, khi id_normalize NOT NULL).

### 3.5. Quan hệ & phụ thuộc module
- `Platform` (Global — ADR-011): **chưa có module Platform**. Cần seed Platform (TikTok Shop, eBay, Amazon, Etsy, Shopify, **Mercari**, **Walmart**) trước (D-03).
- `Seller` → `users`/`employees` (D-05).
- **Order** (metric) — module chưa có; để derived/sau (D-08).

### 3.6. Bảng `account_credential_access_logs` (audit reveal — đề xuất)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id, organization_id, account_id | uuid | |
| accessed_by | uuid | user xem secret |
| field | varchar | field đã reveal |
| ip / user_agent | varchar | |
| created_at | timestamptz | |

> Phục vụ BR-A12. Có thể gộp vào Audit Module chung (ADR-024, sprint sau) — D-10.

---

## 4. API

> Base `/api/v1`. Envelope chuẩn + `errors[]` (ADR-022). Pagination page/limit (ADR-023). Guard JWT + permission `account.*`.

| Method & Path | Permission | Mô tả |
|---|---|---|
| `POST /accounts` | `account.create` | Tạo Account |
| `GET /accounts` | `account.read` | Danh sách (filter/search/sort/pagination). **Không** trả secret. |
| `GET /accounts/:id` | `account.read` | Chi tiết (không secret). |
| `PATCH /accounts/:id` | `account.update` | Cập nhật thông tin/vòng đời. |
| `DELETE /accounts/:id` | `account.delete` | Soft delete. |
| `PATCH /accounts/:id/assign` | `account.assign` | Gán/đổi Seller quản lý (Admin). |
| `PATCH /accounts/:id/status` | `account.update` | Chuyển trạng thái (kèm die_reason). *(hoặc gộp vào PATCH)* |
| `GET /accounts/:id/credentials` | `account.credentials.read` | **Reveal** secret (giải mã) — **ghi audit** mỗi lần. |
| `PATCH /accounts/:id/credentials` | `account.credentials.update` | Cập nhật secret (mã hoá lại). |
| `GET /accounts/overview` | `account.read` | Tổng quan: đếm theo status × seller × platform. |

- **List filter (đề xuất):** `platformId`, `status`, `sellerUserId`, `loginTool`, `search` (name/id_normalize), `issuedFrom/issuedTo`, `diedFrom/diedTo`.
- **Sort:** `createdAt`, `name`, `status`, `issuedAt`, `diedAt`.
- **Response mặc định (ẩn secret):** name, platform, seller, status, các ngày, tuổi thọ (derived), note, docs_url, cờ `hasCredentials`. **Không** kèm password/2fa/ssn/inf.
- **Reveal** trả từng field secret đã giải mã, có `X-Audit` (log). Cân nhắc yêu cầu re-auth/step-up (D-06).
- **Error codes (đề xuất):** `ACCOUNT_NOT_FOUND` (404), `ACCOUNT_DUPLICATE` (409, id_normalize trùng), `ACCOUNT_FORBIDDEN` (403), `PLATFORM_INVALID` (400), `SELLER_INVALID` (400), `VALIDATION_ERROR` (400).
- **Swagger** đầy đủ; **secret KHÔNG xuất hiện trong ví dụ**.

---

## 5. Frontend

> Next.js 15 + shadcn/ui, tuân AuthProvider + token + GET /me (như Employee/Profile). Route dưới `/dashboard`.

### 5.1. Trang & Components
- `/dashboard/accounts` — **List**: table + filter + search + pagination.
  - Table: Tên acc · Nền tảng · Seller · Trạng thái (badge màu Live/Die trắng/Die) · Ngày cấp · Ngày die · Tuổi thọ · Action (View/Edit/Delete/Assign).
- `/dashboard/accounts/create` — form tạo.
- `/dashboard/accounts/[id]` — chi tiết + edit (tabs: **Thông tin vận hành** / **Vòng đời** / **Credentials**).
- Components: `AccountTable`, `AccountForm`, `AccountFilter`, `AccountStatusBadge`, `DeleteDialog`, `AssignSellerDialog`, **`CredentialsPanel`** (ẩn/hiện từng secret qua nút "Reveal" → gọi API reveal → hiển thị + copy; cảnh báo đã ghi audit), `AccountOverview` (đếm theo status/seller/nền tảng + stacked bar).
- **Sidebar**: thêm menu **"Account"** cho role có `account.read` (Admin/Seller). Ẩn với role không có quyền (giống cơ chế ẩn menu Nhân viên).

### 5.2. Tổng quan (Overview)
- Thẻ đếm: tổng Account, Live, Die trắng, Die.
- Bảng **Account theo Seller** (Live/Die trắng/Die) + **biểu đồ cột chồng**.
- Bảng **Account theo Seller × Nền tảng**.
- (Sau, khi có Order) Doanh thu theo Account/tháng, loại DIE.

### 5.3. Bảo mật UI
- Secret **mặc định ẩn** (••••), có nút Reveal (gọi API, audit) + Copy. Không auto-load secret khi mở trang.
- Không đưa secret vào React Query cache lâu dài; không log ra console.

---

## 6. Permission

> Theo RBAC ADR-010 (`resource.action`, gán cho Role). Bổ sung permission cho resource `account`:

| Permission | Ý nghĩa |
|---|---|
| `account.read` | Xem danh sách/chi tiết (không secret) |
| `account.create` | Tạo |
| `account.update` | Cập nhật (gồm status/vòng đời) |
| `account.delete` | Soft delete |
| `account.assign` | Gán/đổi Seller quản lý |
| `account.credentials.read` | **Reveal** secret (nhạy cảm) |
| `account.credentials.update` | Cập nhật secret |

- **Admin**: toàn bộ permission trên.
- **Seller**: `account.read`, `account.update` (giới hạn account của mình — row-level), `account.credentials.read` (account của mình). **Không** `assign`, **không** thấy account người khác. (D-05/D-06)
- **Row-level ownership**: ngoài permission theo Role, cần kiểm tra `account.seller_user_id === currentUser` cho Seller (guard/service). auth.md §3 note "row-level ownership chi tiết" là ngoài phạm vi S1 ⇒ đây là lần đầu cần → **cần chốt cơ chế** (D-05).
- **KHÔNG thay đổi RBAC hiện tại**; chỉ **thêm** permission mới + seed cho Role phù hợp.

---

## 7. Validation

| Field | Rule (đề xuất) |
|---|---|
| name (Tên acc) | required, 1–255, trim |
| platformId | required?(D-03) UUID hợp lệ, thuộc danh mục Platform |
| sellerUserId | optional, UUID hợp lệ, thuộc **cùng Organization** |
| status | ∈ AccountStatus |
| id_normalize | optional, `^[A-Za-z0-9-]+$`, ≤120; unique/org |
| loginTool | optional, ≤100 |
| issuedAt/activatedAt/diedBlankAt/diedAt/moneyReturnedAt | optional, ISO date; **thứ tự hợp lệ** (BR-A06) |
| dieReason | optional (bắt buộc khi status DIE/DIE_TRANG? — BR-A09) |
| proxy | optional, ≤255 |
| ssn | optional, định dạng SSN (9 số) — nhạy cảm |
| phoneReg | optional, định dạng phone |
| gmail / recoveryMail | optional, email hợp lệ |
| gmailPassword / platformPassword | optional, ≤255 — **secret** (mã hoá) |
| platform2faSecret / recoveryMail2fa | optional — **secret** (mã hoá) |
| docsUrl / (avatar-like URLs) | optional URL, ≤1024 |
| note / note2 | optional, ≤1000 |

| holdAmount / netAmount / paidAmount | optional, number **>= 0**, ≤ 9.999.999.999.999, tối đa 2 chữ số thập phân (khớp DECIMAL(15,2)); default 0 |

- Whitelist DTO (chặn field lạ), forbidNonWhitelisted. `organization_id` **không** nhận từ client (lấy từ token).

### 7.1. Import / Export Excel (cập nhật 2026-07-29)

- **Template** (`GET /accounts/export/example`) và **Export** (`GET /accounts/export`) chứa **đầy đủ cột
  nghiệp vụ**: Account Name · Platform · Login Tool · Seller Email · Status · 5 mốc ngày · Die Reason ·
  **Hold Amount · Net Amount · Paid Amount** · Username · Password · Email · Proxy · Docs URL · Note ·
  Note 2 (Export thêm `ID`, `Created At`, `Updated At`). Template có thêm sheet **Instructions**.
- **Import** (`POST /accounts/import`): khoá đối chiếu = **Account Name + Platform**.
  Chưa tồn tại → **CREATE**; đã tồn tại → **UPDATE**. Ô trống = giữ nguyên giá trị hiện tại.
  Một dòng lỗi → **không ghi dòng nào** (một `$transaction`, rollback toàn bộ).
- **Tương thích ngược:** tên cột cũ giữ nguyên + có alias; header khớp qua `normalizeHeader`
  (bỏ `*`, gộp khoảng trắng/NBSP, bỏ BOM/zero-width) nên **file Import/Export cũ vẫn dùng được**;
  file cũ thiếu 3 cột tiền → nhận mặc định 0.
- Cột tiền là **cell Number** (`#,##0.00`), cột ngày là **cell Date** (`yyyy-mm-dd`); header có style,
  auto width, freeze dòng 1.
- ⚠️ Export **không** xuất SSN / INF / 2FA secret (BR-A12: secret chỉ lộ qua endpoint reveal có audit).
  Ba cột `Username / Password / Email` giữ nguyên như bản cũ để không phá file đang dùng.

---

## 8. Acceptance Criteria

**Chức năng (MVP)**
- [ ] CRUD Account tenant-scoped; Admin org A không thấy/không sửa Account org B.
- [ ] Tạo Account: name bắt buộc; gán Platform + Seller (cùng org); status mặc định `NEW`.
- [ ] Cập nhật vòng đời/trạng thái + các mốc ngày (kiểm tra thứ tự) + die_reason.
- [ ] Soft delete (không hard delete).
- [ ] Danh sách: filter (platform/status/seller), search (name/id_normalize), sort, pagination page/limit.
- [ ] **Secret KHÔNG lộ** ở GET/list/detail; chỉ reveal qua endpoint riêng + permission `account.credentials.read` + **ghi audit**.
- [ ] Secret **mã hoá at-rest** (không plaintext, không hash); giải mã đúng khi reveal.
- [ ] Tổng quan: đếm Account theo status × seller × nền tảng.
- [ ] Permission mới seed đúng; **RBAC cũ không đổi**; Seller chỉ thấy account của mình (row-level).
- [ ] Sidebar hiển thị menu Account theo quyền; ẩn với người không có `account.read`.

**Chất lượng (DoD — CLAUDE.md §20)**
- [ ] Migration + seed Platform/permission; UUID PK; soft delete; audit cols; `organization_id`.
- [ ] DTO + validation + Swagger + error `errors[]`; không lộ secret trong Swagger/log.
- [ ] Test tenant isolation (2 org); test không-lộ-secret; test reveal ghi audit.
- [ ] Không lỗi TypeScript; không TODO/FIXME; Frontend build + lint sạch.
- [ ] Được PO review & chấp thuận.

---

## 9. Decisions cần PO chốt

> ⚠️ **Chưa implement cho tới khi các quyết định dưới đây được chốt.**

| ID | Vấn đề | Phương án / Đề xuất |
|---|---|---|
| **D-01** | **Mã hoá secret at-rest** (Pass Gmail/nền tảng, 2FA, SSN, INF…) | Cần **ADR mới (ADR-025)**: AES-256-GCM, KEK từ KMS/ENV, envelope encryption. **Đây là chặn quan trọng nhất.** |
| **D-02** | Danh sách **AccountStatus** chính thức | Đề xuất: `NEW, LIVE, DIE_TRANG, DIE, RETURNED`. PO xác nhận + nhãn hiển thị. |
| **D-03** | **Platform** bắt buộc? Nguồn danh mục? | Cần module/seed **Platform (Global — ADR-011)**: TikTok Shop, eBay, Amazon, Etsy, Shopify, **Mercari**, Walmart. platform_id required hay optional? |
| **D-04** | Cơ chế **"Check trùng lặp"** & `ID_Normalize` | Unique theo (org, id_normalize)? Chuẩn hoá thế nào (bỏ dấu cách, upper)? Chặn cứng hay chỉ cảnh báo? |
| **D-05** | **"Seller quản lý" là gì?** | Là **Role động** (vd `SELLER`) trên User, hay link tới **Employee**? Đề xuất: link `seller_user_id → users` (role SELLER). Ảnh hưởng row-level & Permission. |
| **D-06** | **Reveal secret**: ai/khi nào/re-auth? | Chỉ `account.credentials.read`; Seller chỉ account của mình; có yêu cầu **step-up (nhập lại mật khẩu)** khi reveal? Bắt buộc audit. |
| **D-07** | Tách bảng `account_credentials` (1-1) hay gộp vào `accounts`? | Đề xuất **tách** (cô lập bảo mật). |
| **D-08** | **Metric** (đơn/doanh thu/balance/tuổi thọ) | Derived từ Order (chưa có) ⇒ **hoãn**? Hay nhập tay snapshot MVP? Tuổi thọ tính runtime (không lưu). |
| **D-09** | **Report "Tổng quan account"** | MVP chỉ đếm trạng thái (không cần Order)? Doanh thu/tháng để **module Report** sau? |
| **D-10** | **Audit truy cập credentials** | Bảng riêng `account_credential_access_logs` hay chờ **Audit Module** (ADR-024)? |
| **D-11** | **Import** từ Excel/Google Sheet cũ | Có cần import hàng loạt ban đầu (40 cột)? Mapping "theo Sheet" bỏ được không? |
| **D-12** | Naming module/entity | Business gọi **"Account"**, ADR-011 gọi **"ShopAccount"**. Chốt tên bảng/route (`accounts` vs `shop_accounts`). |
| **D-13** | Ý nghĩa cột **VSV**, **Net**, **Hold**, **Doanh thu theo Sheet vs Acc** | Cần PO giải nghĩa nghiệp vụ để xử lý đúng (hay loại bỏ). |
| **D-14** | Bắt buộc **die_reason** khi chuyển DIE? Ràng buộc thứ tự ngày? | Xác nhận BR-A06/A09. |

---

## 10. Phụ thuộc & thứ tự triển khai (đề xuất)

1. **ADR-025 Secrets Encryption** (D-01) — **bắt buộc trước**.
2. **Platform** (Global seed) — D-03.
3. **Account** core (CRUD + vòng đời + credentials mã hoá + permission + audit reveal).
4. **Overview** đếm trạng thái.
5. (Sau) Order → metric doanh thu/balance → Report tổng quan.

> **Trạng thái tài liệu:** 🟡 **DRAFT — chờ Product Owner review & chốt Mục 9.**
> Sau khi `docs/account.md` được **ACCEPTED**, mới bắt đầu implement theo workflow ADR-019.
