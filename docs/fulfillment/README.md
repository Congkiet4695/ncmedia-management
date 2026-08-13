# Module Fulfillment — gửi đơn POD sang xưởng in

> Nhà cung cấp đầu tiên: **MangoTeePrints** (MangoV3 Public API).
> Kiến trúc đa nhà cung cấp ngay từ đầu — thêm Printify/Printful chỉ cần viết thêm
> một client + mapper, không đổi lược đồ DB và không sửa module POD.

---

## 1. Nguồn tài liệu

⚠️ **Trong repo KHÔNG có tài liệu MangoTeePrints nào** (đã tìm toàn bộ `docs/`, `docs/business/`).
Toàn bộ đặc tả lấy từ trang chính thức **https://docs.mangoteeprints.com** (bản MangoV3),
tải về và đối chiếu từng endpoint. Không có endpoint/enum nào được suy đoán.

| Thông tin | Giá trị |
|---|---|
| Base URL | `https://v3.mangoteeprints.com/api/public/v1` |
| Xác thực | Header `X-API-Key` (KHÔNG phải Bearer) |
| Giới hạn | 10 request/giây; header `X-RateLimit-*` |
| Envelope | `{ status, code, message, data, timestamp, request_id }` |
| Mã lỗi | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_ERROR` |

### Endpoint đang dùng

| Endpoint | Dùng để |
|---|---|
| `POST /orders` | Tạo đơn sản xuất |
| `GET /orders/{order_id}` | Đồng bộ trạng thái + vận đơn |
| `POST /orders/{order_id}/cancel` | Huỷ đơn (chỉ khi `new_order` / `on_hold`) |
| `GET /products`, `GET /products/{id}/variations` | Tra SKU để khai ánh xạ |
| `GET /production-lines` | Danh sách production line + shipping method hỗ trợ |
| `POST /webhooks`, `GET /webhooks` | Đăng ký nhận sự kiện |

Chưa dùng (có trong tài liệu): `GET /orders` (danh sách), `PUT /orders/{id}` (sửa đơn),
`DELETE /orders/{id}`, `GET /catalogs`, CRUD webhook còn lại.

---

## 2. Enum lấy nguyên văn từ tài liệu

**`OrderStatus`**: `new_order` · `in_production` · `shipped` · `rejected` · `on_hold` ·
`cancelled` · `in_production_cancelled` · `full_refunded` · `partial_refunded`

**`ShippingMethod`**: `standard` · `priority` · `express` · `global` · `by_tiktok` ·
`by_seller` · `dhl_parcel_ground` · `dhl_parcel_expedited`

**`SpeedType`**: `rush` · `expedite` (chỉ FASTUS)

**`print_files[].key`** (20 vị trí): `front`, `back`, `right_sleeve`, `left_sleeve`,
`neck_label`, `right_wrist`, `left_wrist`, `center_chest`, `right_chest`, `left_chest`,
`right_cuff`, `left_cuff`, `collar`, `left_slit`, `right_slit`, `sock_collar`,
`center_hat`, `left_hat`, `right_hat`, `back_hat`

**`WebhookEvent`**: `order.status` · `order.shipment`

🔴 Trạng thái provider KHÔNG có trong bảng ánh xạ sẽ về `UNKNOWN` — giá trị gốc vẫn lưu
nguyên văn ở `provider_status` nên không mất thông tin và không đoán bừa.

---

## 3. Điều kiện gửi đơn (Ready to Fulfill)

Kiểm tra tại `FulfillmentReadinessService` — dùng CHUNG cho cả UI lẫn luồng gửi thật,
nên UI không bao giờ báo sẵn sàng rồi backend từ chối.

| Mã lỗi | Ý nghĩa |
|---|---|
| `ACCOUNT_MISSING` | Chưa cấu hình tài khoản nhà cung cấp |
| `ORDER_CANCELLED` | Đơn TikTok đã huỷ / chưa thanh toán |
| `NO_ITEMS` | Đơn không có sản phẩm |
| `ADDRESS_MISSING` | Chưa có địa chỉ người nhận |
| 🔴 `ADDRESS_MASKED` | TikTok đã che địa chỉ (đơn 4PL US hoặc quá hạn hiển thị) |
| `ADDRESS_INCOMPLETE` | Thiếu tên/địa chỉ/thành phố/bang/quốc gia/mã bưu chính |
| `MAPPING_MISSING` | Chưa khai ánh xạ sản phẩm → SKU nhà cung cấp |
| `DESIGN_MISSING` | Sản phẩm chưa có file design |
| 🔴 `DESIGN_NOT_PUBLIC` | Design không có URL công khai (xưởng in phải tải được file) |
| `PLACEMENT_UNSUPPORTED` | Vị trí in chưa có ánh xạ sang nhà cung cấp |

Mọi lý do được gom lại **cùng lúc**, không dừng ở lỗi đầu tiên.

---

## 4. Ánh xạ

### Product / Variant

Bảng `fulfillment_product_mappings`, khai báo qua UI — **không hardcode**.
Thứ tự khớp (cụ thể → tổng quát):

```
tiktok_sku_id  →  seller_sku  →  tiktok_product_id
```

Nhờ vậy có thể khai chung cho cả sản phẩm rồi ghi đè riêng cho một biến thể.
Ánh xạ đã tắt (`is_active = false`) không được dùng.

### Design → print_files

Design đã nằm trên **Cloudflare R2** (Storage Module) — hệ thống **KHÔNG upload lại file**,
chỉ truyền `publicUrl` vào `print_files[].url`. Mango tự tải file từ URL đó.

Ánh xạ vị trí mặc định (ghi đè được từng sản phẩm qua `placement_map`):

| NCMedia | Mango |
|---|---|
| `FRONT` | `front` |
| `BACK` | `back` |
| `LEFT` | `left_sleeve` |
| `RIGHT` | `right_sleeve` |
| `SLEEVE` | `left_sleeve` |
| `LABEL` | `neck_label` |

Hỗ trợ nhiều artwork trên một sản phẩm: mỗi design là một phần tử `print_files[]`.

### Địa chỉ TikTok → Mango

TikTok trả `district_info[]` theo cấp (L0 quốc gia … L3 phường/xã); Mango cần `city`/`state`
tách riêng nên phải bóc từ mảng này. Tên: ưu tiên `first_name`/`last_name`; nếu chỉ có `name`
thì tách từ CUỐI làm họ (đúng định dạng tên thị trường US).

---

## 5. Idempotency — không bao giờ sản xuất trùng

Ba lớp bảo vệ:

1. **UNIQUE `(pod_order_id, provider)`** ở DB — hai người bấm Fulfill cùng lúc, chỉ một thắng.
2. **Kiểm tra trạng thái** — chỉ `DRAFT`/`FAILED` mới được gửi.
3. 🔴 **`order_id` do NCMedia sinh** (`NC-{tiktokOrderId}`, ≤40 ký tự) — Mango **báo lỗi nếu trùng**.
   Retry dùng lại đúng mã cũ, nên nếu lần trước thực ra đã tới nơi thì Mango từ chối
   thay vì tạo đơn thứ hai.

---

## 6. Đồng bộ trạng thái

**Webhook** (nhanh) + **Scheduler** (lưới an toàn) — không thay thế nhau:

- Webhook `order.status` / `order.shipment` chỉ mang trạng thái, **không đủ dữ liệu đơn**
  ⇒ dùng làm *tín hiệu* rồi gọi `GET /orders/{id}` để lấy trạng thái đầy đủ.
  Cả webhook lẫn cron đi qua **cùng một** hàm `applyProviderState` ⇒ không có hai đường
  cập nhật khác nhau.
- Scheduler chạy theo `FULFILLMENT_SYNC_CRON` (mặc định 5 phút), chỉ hỏi đơn **chưa ở
  trạng thái kết thúc**, ưu tiên đơn lâu chưa đồng bộ nhất.

### 🔴 Hạn chế bảo mật webhook (tài liệu Mango thiếu)

Tài liệu Mango (`Webhooks`, schema `WebhookCreate`) **không mô tả cơ chế ký payload** —
không secret, không header chữ ký. Vì vậy **không thể xác minh chữ ký theo chuẩn nhà cung cấp**.

Biện pháp thay thế đang dùng: mỗi tài khoản có một `webhookSecret` do NCMedia sinh, nhúng
vào chính đường dẫn đăng ký với Mango:

```
POST {FULFILLMENT_WEBHOOK_BASE_URL}/api/v1/fulfillment/webhooks/mango/{secret}
```

Request không mang đúng secret bị từ chối (so sánh thời gian hằng định). Secret chỉ hiển thị
**một lần** ngay sau khi tạo tài khoản.

**Rủi ro còn lại:** secret nằm trên URL nên có thể lộ qua log của proxy/CDN. Khi Mango bổ
sung chữ ký, hãy chuyển sang xác thực chữ ký và bỏ secret khỏi URL.

Webhook được **lưu RAW trước, xử lý sau** (`fulfillment_webhook_logs`) ⇒ không mất sự kiện.
Xử lý lỗi thì nằm lại hàng đợi, scheduler thử lại; quá `FULFILLMENT_WEBHOOK_MAX_ATTEMPTS`
⇒ chuyển **dead letter** để người vận hành xem.

---

## 7. Cơ sở dữ liệu

| Bảng | Vai trò |
|---|---|
| `fulfillment_accounts` | Cấu hình nhà cung cấp; API key mã hoá AES-256-GCM |
| `fulfillment_product_mappings` | TikTok product/SKU ⇄ SKU nhà cung cấp |
| `fulfillment_orders` | Một lần gửi đơn; giữ `raw_request`/`raw_response` |
| `fulfillment_order_items` | Ảnh chụp dòng sản phẩm đã gửi (bất biến) |
| `fulfillment_histories` | **Append-only** — mọi thao tác/chuyển trạng thái |
| `fulfillment_error_logs` | Chi tiết lỗi: HTTP status, code, validation errors |
| `fulfillment_webhook_logs` | Payload webhook nguyên văn + hàng đợi retry |
| `fulfillment_sync_logs` | Số liệu từng lượt đồng bộ |

PII người nhận được **che trước khi lưu** `raw_request` (giữ city/state/zip để đối soát vùng
giao hàng — không định danh cá nhân).

---

## 8. API

| Method | Path | Permission |
|---|---|---|
| GET/POST/PATCH | `/fulfillment/accounts` | `fulfillment.config` |
| GET/POST/PATCH/DELETE | `/fulfillment/mappings` | `fulfillment.config` |
| GET | `/fulfillment/orders/{podOrderId}` | `fulfillment.read` |
| POST | `/fulfillment/orders/{podOrderId}/fulfill` | `fulfillment.create` |
| POST | `/fulfillment/orders/{podOrderId}/retry` | `fulfillment.create` |
| POST | `/fulfillment/orders/{podOrderId}/sync` | `fulfillment.read` |
| POST | `/fulfillment/orders/{podOrderId}/cancel` | `fulfillment.cancel` |
| GET | `/fulfillment/orders/{podOrderId}/history` | `fulfillment.read` |
| GET | `/fulfillment/orders/{podOrderId}/errors` | `fulfillment.read` |
| POST | `/fulfillment/sync` | `fulfillment.read` |
| POST | `/fulfillment/webhooks/mango/{secret}` | *(công khai — xác thực bằng secret)* |

---

## 9. Phân loại lỗi & retry

| Lớp lỗi | Nguồn | Retry? |
|---|---|---|
| `AUTH` | `UNAUTHORIZED`/`FORBIDDEN`, HTTP 401/403 | ❌ lỗi cấu hình |
| `VALIDATION` | `VALIDATION_ERROR`, HTTP 400/422 | ❌ phải sửa dữ liệu |
| `NOT_FOUND` | `NOT_FOUND`, HTTP 404 | ❌ |
| `RATE_LIMIT` | `RATE_LIMIT_EXCEEDED`, HTTP 429 | ✅ |
| `NETWORK` | timeout / lỗi kết nối | ✅ |
| `SERVER` | `INTERNAL_ERROR`, HTTP 5xx | ✅ |

Mango có thể trả **HTTP 200 kèm `status: false`** ⇒ client kiểm tra **cả hai**, không chỉ status code.

---

## 10. Cấu hình

| ENV | Mặc định | Ý nghĩa |
|---|---|---|
| `FULFILLMENT_WEBHOOK_BASE_URL` | rỗng | Base URL công khai để dựng URL webhook |
| `MANGO_API_KEY` | rỗng | **API key MangoTeePrints** (header `X-API-Key`) — nguồn cấu hình chính |
| `MANGO_API_BASE_URL` | `https://v3.mangoteeprints.com/api/public/v1` | |
| `MANGO_HTTP_TIMEOUT_MS` | `30000` | |
| `FULFILLMENT_SYNC_ENABLED` | `false` | Bật scheduler |
| `FULFILLMENT_SYNC_CRON` | `*/5 * * * *` | |
| `FULFILLMENT_SYNC_BATCH_SIZE` | `100` | Số đơn hỏi trạng thái mỗi lượt |
| `FULFILLMENT_SYNC_DEADLINE_MS` | `240000` | Phải NHỎ HƠN chu kỳ cron |
| `FULFILLMENT_WEBHOOK_MAX_ATTEMPTS` | `5` | Quá ngưỡng ⇒ dead letter |

### API key lấy từ đâu

`MangoCredentialService` là nơi DUY NHẤT quyết định, theo thứ tự:

1. `fulfillment_accounts.api_key_enc` — key RIÊNG của tài khoản (mã hoá AES-256-GCM).
   Chỉ khai báo khi cần nhiều tài khoản Mango khác nhau. Có thì key này thắng.
2. `MANGO_API_KEY` trong biến môi trường — **nguồn cấu hình chính**, dùng cho mọi tài khoản
   không khai key riêng.

Không có nguồn nào ⇒ ném `FULFILLMENT_CONFIG_MISSING` ngay, kèm tên biến cần đặt, thay vì để
Mango trả 401 khó hiểu.

🔴 API key **không bao giờ** hardcode trong source, không ghi log, không trả về qua API.
Log chỉ ghi *nguồn* của key (`ENV` / `ACCOUNT`) để chẩn đoán cấu hình.

Muốn ENV luôn thắng (một tài khoản Mango duy nhất cho toàn hệ thống): đảo hai nhánh trong
`MangoCredentialService.resolveApiKey()` — chỉ một chỗ.
