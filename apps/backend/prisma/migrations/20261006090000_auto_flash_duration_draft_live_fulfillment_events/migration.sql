-- Auto Flash Sale "Khoảng thời gian" · Draft Listing đã lên sàn · sự kiện timeline fulfillment.
-- Chỉ THÊM: không xoá / đổi kiểu cột nào. Cấu hình cũ nhận mặc định (CALENDAR_DAYS, 3 ngày).

-- 1) Auto Flash Sale — cách tính giờ kết thúc + khoảng thời gian (ngày lịch)
CREATE TYPE "pod_flash_sale_auto_duration_mode" AS ENUM ('CALENDAR_DAYS');
CREATE TYPE "pod_flash_sale_auto_duration" AS ENUM ('ONE_DAY', 'TWO_DAYS', 'THREE_DAYS');

ALTER TABLE "pod_flash_sale_auto_configs"
  ADD COLUMN "duration_mode" "pod_flash_sale_auto_duration_mode" NOT NULL DEFAULT 'CALENDAR_DAYS',
  ADD COLUMN "duration"      "pod_flash_sale_auto_duration"      NOT NULL DEFAULT 'THREE_DAYS';

-- 2) Draft Listing — mốc lần đầu TikTok báo sản phẩm ĐANG BÁN. Bản ghi giữ nguyên (chốt chống
--    publish trùng + Publish History); màn Draft Listings chỉ ẩn những dòng có mốc này.
ALTER TABLE "pod_listing_payloads" ADD COLUMN "went_live_at" TIMESTAMPTZ(6);

-- Dữ liệu cũ: listing ĐANG BÁN tại thời điểm migrate ⇒ mốc = lần cuối hệ thống thấy trạng thái đó.
-- Chỉ ghi cột mới (dẫn xuất từ review_status đã có) — không đổi dữ liệu nghiệp vụ nào.
UPDATE "pod_listing_payloads"
   SET "went_live_at" = COALESCE("review_checked_at", "published_at", "updated_at")
 WHERE "status" = 'PUBLISHED'
   AND "review_status" = 'ACTIVE'
   AND "went_live_at" IS NULL;

-- 3) Timeline fulfillment — phân biệt "nhà cung cấp đã nhận đơn" với "ghi local / lấy giá vốn hỏng"
ALTER TYPE "fulfillment_event_type" ADD VALUE IF NOT EXISTS 'BASE_COST_UPDATED';
ALTER TYPE "fulfillment_event_type" ADD VALUE IF NOT EXISTS 'BASE_COST_FETCH_FAILED';
ALTER TYPE "fulfillment_event_type" ADD VALUE IF NOT EXISTS 'BASE_COST_MANUAL_UPDATED';
ALTER TYPE "fulfillment_event_type" ADD VALUE IF NOT EXISTS 'LOCAL_UPDATE_FAILED';
ALTER TYPE "fulfillment_event_type" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REQUIRED';
