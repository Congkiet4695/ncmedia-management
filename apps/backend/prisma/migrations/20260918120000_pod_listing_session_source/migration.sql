-- Nguồn của một Listing Session: IMPORT (lô Excel/CSV) hay CUSTOM (Add Custom Listing).
--
-- Thuần bổ sung: enum mới + cột có giá trị mặc định, không đụng dữ liệu cũ. Mọi lượt đăng đã
-- có được coi là IMPORT, trừ những lượt mang đúng dấu hiệu của Custom Listing (chưa từng
-- import file, đúng MỘT sản phẩm và sản phẩm đó có dữ liệu nhập tay) — backfill một lần để
-- người dùng mở lại được form đầy đủ cho các bản nháp đã tạo trước migration này.
CREATE TYPE "pod_listing_session_source" AS ENUM ('IMPORT', 'CUSTOM');

ALTER TABLE "pod_listing_sessions"
  ADD COLUMN "source" "pod_listing_session_source" NOT NULL DEFAULT 'IMPORT';

UPDATE "pod_listing_sessions" s
SET "source" = 'CUSTOM'
WHERE s."source_file" IS NULL
  AND s."deleted_at" IS NULL
  AND (
    SELECT COUNT(*) FROM "pod_listing_session_products" p
    WHERE p."session_id" = s."id" AND p."deleted_at" IS NULL
  ) = 1
  AND EXISTS (
    SELECT 1 FROM "pod_listing_session_products" p
    WHERE p."session_id" = s."id" AND p."deleted_at" IS NULL AND p."manual_data" IS NOT NULL
  );
