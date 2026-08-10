# Storage Module (Core) — Cloudflare R2

> Module lõi lưu trữ file dùng chung toàn hệ thống.
> Mọi module nghiệp vụ (Employee Avatar, Order Design, POD Design, Shipping Label,
> Excel Import/Export) **bắt buộc** upload qua `StorageService` — không module nào được
> tự ghi file hay gọi thẳng Cloudflare R2.

---

## 1. Requirement

| # | Yêu cầu | Hiện thực |
|---|---|---|
| R-01 | Provider lưu trữ: Cloudflare R2 | `CloudflareR2Provider` (AWS SDK S3-compatible) |
| R-02 | R2 chỉ được gọi qua Provider | `StorageProvider` là ranh giới duy nhất chạm hạ tầng |
| R-03 | Không hardcode, đọc config từ ENV | `config/configuration.ts` → `storage.*`, validate bằng Joi |
| R-04 | Tên file sinh bằng UUID | `randomUUID()` + đuôi đã chuẩn hoá; tên người dùng chỉ lưu để hiển thị |
| R-05 | Chỉ cho phép png, jpg, jpeg, webp, pdf, psd | `STORAGE_ALLOWED_TYPES` |
| R-06 | Không cho phép executable | `STORAGE_BLOCKED_EXTENSIONS` (~40 đuôi) |
| R-07 | Validate đầy đủ | rỗng / dung lượng / mime / đuôi / mime≠đuôi |
| R-08 | Không expose Secret Key | credential chỉ nằm trong `CloudflareR2Provider`; API không trả `objectKey`/`bucket` |
| R-09 | Đổi provider không phải sửa module nghiệp vụ | factory trong `storage.module.ts` là nơi duy nhất quyết định |
| R-10 | Module Order dùng `StorageService` để upload Design | `PodOrderDesignService` đã chuyển sang `StorageService` |

---

## 2. Business Rules

- **BR-S01** — Một file luôn thuộc đúng **một** Organization. Mọi truy vấn đều lọc theo
  `organizationId` lấy từ JWT (ADR-004). Client không được truyền `organizationId`.
- **BR-S02** — Tên file trên kho lưu trữ **luôn** là `{uuid}.{ext}`. Tên gốc chỉ lưu ở
  `original_name` để hiển thị và đặt `Content-Disposition` khi tải về.
- **BR-S03** — File phải qua **ba lớp** kiểm tra định dạng, theo thứ tự:
  1. Đuôi nằm trong danh sách CẤM → từ chối (`STORAGE_EXTENSION_BLOCKED`).
  2. Đuôi phải nằm trong danh sách CHO PHÉP (`STORAGE_UNSUPPORTED_TYPE`).
  3. Mime type phải khớp đuôi (`STORAGE_MIME_EXTENSION_MISMATCH`) — chặn file đổi đuôi.
- **BR-S04** — File rỗng (0 byte) bị từ chối.
- **BR-S05** — Vượt `STORAGE_MAX_FILE_BYTES` bị từ chối (413).
- **BR-S06** — Không xoá được file đang được bản ghi nghiệp vụ tham chiếu qua
  `DELETE /storage/{id}` (409 `STORAGE_FILE_IN_USE`); phải xoá ở màn hình nghiệp vụ.
  Khoá ngoại `ON DELETE RESTRICT` là hàng rào cuối cùng.
- **BR-S07** — Xoá file = **xoá mềm** metadata + xoá object trên kho lưu trữ. Giữ dòng
  `storage_files` đã xoá để đối soát.
- **BR-S08** — Thứ tự ghi khi upload: đẩy object **trước**, ghi metadata **sau**.
  Ghi metadata hỏng ⇒ dọn object vừa tạo (không để file mồ côi).
- **BR-S09** — Upload nhiều file: một file lỗi ⇒ **huỷ toàn bộ** lần gọi và gỡ các file
  đã lên trước đó.
- **BR-S10** — `delete` trên provider là **idempotent**: xoá object không tồn tại không
  phải lỗi.
- **BR-S11** — Đường dẫn thư mục luôn được chuẩn hoá; mọi thành phần `.`/`..` bị loại —
  không thể thoát khỏi tiền tố của tổ chức (path traversal).

---

## 3. Database

### 3.1. `storage_files`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid | tenant (ADR-004) |
| `module` | enum `StorageModuleName` | POD_TIKTOK, EMPLOYEE, ORDER, ACCOUNT, REPORT, COMMON |
| `reference_type` | enum `StorageReferenceType` | POD_ORDER_ITEM_DESIGN, EMPLOYEE_AVATAR, EMPLOYEE_CCCD, ACCOUNT_DOCUMENT, ORDER_ATTACHMENT, SHIPPING_LABEL, EXCEL_IMPORT, EXCEL_EXPORT, OTHER |
| `reference_id` | uuid NULL | NULL với file không gắn thực thể (vd file export) |
| `folder` | varchar(512) | thư mục logic trong bucket |
| `object_key` | varchar(1024) **UNIQUE** | khoá đối tượng đầy đủ — dùng để đọc/xoá |
| `original_name` | varchar(255) | tên người dùng chọn (chỉ hiển thị) |
| `stored_name` | varchar(255) | `{uuid}.{ext}` |
| `extension` | varchar(20) | chữ thường, không có dấu chấm |
| `mime_type` | varchar(150) | |
| `file_size` | int | byte |
| `public_url` | varchar(2048) NULL | NULL khi bucket private |
| `provider` | enum `StorageProviderName` | CLOUDFLARE_R2, LOCAL_DISK, AWS_S3, MINIO, GCS |
| `bucket` | varchar(255) NULL | bucket tại thời điểm upload |
| `checksum` | char(64) NULL | sha256 hex |
| `uploaded_by` / `uploaded_at` | uuid / timestamptz | |
| audit | `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by` | ADR-015 |

CHECK constraints:
- `storage_files_file_size_check` — `file_size > 0`
- `storage_files_key_check` — `object_key` / `folder` / `original_name` / `stored_name` không rỗng
- `storage_files_extension_check` — `extension` chữ thường, không bắt đầu bằng dấu chấm

### 3.2. `pod_order_item_designs` (đã refactor)

Bỏ các cột `file_key`, `file_url`, `file_name`, `mime_type`, `file_size`, `uploaded_by`,
`uploaded_at`. Thay bằng **một** khoá ngoại `storage_file_id → storage_files.id`
(`ON DELETE RESTRICT`). Một nguồn sự thật duy nhất cho metadata file.

> ⚠️ Migration `20260806103400_storage_module_r2` **xoá sạch** dữ liệu bảng
> `pod_order_item_designs` cũ: các design trước đây nằm trên đĩa cục bộ, không có bản ghi
> tương ứng trong `storage_files` nên không thể tự động chuyển đổi. Design phải upload lại.

### 3.3. Cấu trúc object key

```
{module}/{organizationId}/{referenceType|folder}/{referenceId}/{uuid}.{ext}
```

POD Design dùng thư mục riêng do module tự chỉ định:

```
pod/designs/{organizationId}/{orderItemId}/{uuid}.png
```

Tiền tố luôn bắt đầu bằng tổ chức ⇒ rà soát/gỡ bỏ/phân quyền theo tiền tố đều thuận tiện.

---

## 4. API

Base: `/api/v1/storage` — tất cả yêu cầu `Authorization: Bearer <access_token>`.

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| POST | `/storage/upload` | `storage.upload` | Tải 1..20 file (multipart, field `files`) |
| GET | `/storage` | `storage.read` | Danh sách file của tổ chức (phân trang, lọc) |
| GET | `/storage/reference` | `storage.read` | File gắn với một thực thể (`referenceType` + `referenceId`) |
| GET | `/storage/{id}` | `storage.read` | Metadata một file |
| GET | `/storage/{id}/download` | `storage.read` | Tải nội dung file (có kiểm quyền + tenant) |
| DELETE | `/storage/{id}` | `storage.delete` | Xoá file (chặn nếu đang được tham chiếu) |

`POST /storage/upload` — `multipart/form-data`:

| Field | Bắt buộc | Mô tả |
|---|---|---|
| `files` | ✔ | 1..20 file |
| `module` | ✔ | enum `StorageModuleName` |
| `referenceType` | ✔ | enum `StorageReferenceType` |
| `referenceId` | | uuid thực thể nghiệp vụ |
| `folder` | | thư mục logic tuỳ chọn, vd `exports/2026` |

Mã lỗi:

| Code | HTTP | Khi nào |
|---|---|---|
| `STORAGE_FILE_MISSING` | 400 | Không gửi file |
| `STORAGE_FILE_EMPTY` | 400 | File 0 byte |
| `STORAGE_FILE_TOO_LARGE` | 413 | Vượt `STORAGE_MAX_FILE_BYTES` |
| `STORAGE_UNSUPPORTED_TYPE` | 422 | Đuôi ngoài danh sách cho phép |
| `STORAGE_EXTENSION_BLOCKED` | 422 | Đuôi thực thi/kịch bản |
| `STORAGE_MIME_EXTENSION_MISMATCH` | 422 | Mime không khớp đuôi |
| `STORAGE_FILE_NOT_FOUND` | 404 | Không có file trong tổ chức |
| `STORAGE_OBJECT_NOT_FOUND` | 404 | Metadata còn nhưng object đã mất |
| `STORAGE_FILE_IN_USE` | 409 | File đang được nghiệp vụ tham chiếu |
| `STORAGE_UPLOAD_FAILED` / `DELETE_FAILED` / `DOWNLOAD_FAILED` | 502 | Lỗi nhà cung cấp |
| `STORAGE_PROVIDER_TIMEOUT` | 504 | Nhà cung cấp phản hồi quá chậm |
| `STORAGE_PROVIDER_UNAUTHORIZED` / `STORAGE_BUCKET_NOT_FOUND` | 502 | Sai credential / sai bucket (lỗi cấu hình) |

---

## 5. Cấu hình (ENV)

| Biến | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `STORAGE_PROVIDER` | | `LOCAL_DISK` | `CLOUDFLARE_R2` \| `LOCAL_DISK` |
| `STORAGE_MAX_FILE_BYTES` | | `26214400` (25MB) | trần cứng tầng multer là 100MB |
| `STORAGE_TIMEOUT_MS` | | `30000` | timeout gọi nhà cung cấp |
| `R2_ACCOUNT_ID` | ✔ khi R2 | | Cloudflare Dashboard → R2 |
| `R2_ACCESS_KEY` | ✔ khi R2 | | **không commit** |
| `R2_SECRET_KEY` | ✔ khi R2 | | **không commit** |
| `R2_BUCKET` | ✔ khi R2 | | |
| `R2_PUBLIC_URL` | | rỗng | rỗng ⇒ bucket private, file tải qua API |
| `UPLOAD_ROOT` / `UPLOAD_URL_PREFIX` / `UPLOAD_PUBLIC_BASE_URL` | | `./uploads`, `/uploads`, rỗng | chỉ dùng khi `LOCAL_DISK` |

Endpoint R2: `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region `auto`.
R2 **không** hỗ trợ ACL của S3 — quyền đọc công khai bật ở cấp bucket
(R2 Public Bucket / custom domain), hệ thống chỉ dựng URL từ `R2_PUBLIC_URL`.

---

## 6. Đổi nhà cung cấp

Chỉ hai việc:

1. Viết một class kế thừa `StorageProvider` (`put` / `get` / `delete` / `exists` /
   `resolvePublicUrl`), ném `StorageProviderException` đã phân loại thay vì lỗi thô của SDK.
2. Thêm một nhánh vào `createStorageProvider()` trong `storage.module.ts` và đặt
   `STORAGE_PROVIDER` tương ứng.

**Không** module nghiệp vụ nào phải sửa — tất cả đều gọi qua `StorageService`.
Cột `provider` + `bucket` lưu theo từng file nên có thể chuyển dần từng phần.
