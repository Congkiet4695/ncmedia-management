-- ============================================================================
-- BRAND MODE — tách "No brand" (ý định của người dùng) khỏi "chưa cấu hình brand"
--
-- 🔴 Bối cảnh: template chọn "No brand" nhưng sản phẩm lên TikTok lại mang thương hiệu
-- "TestCase-Authorization".
--
-- Nguyên nhân: `POD_TIKTOK_NO_BRAND_ID = '7082427311584347905'` là một `brand_id` VIẾT CỨNG
-- trong mã, được chú thích là "No brand toàn cầu của TikTok" nhưng CHƯA HỀ được TikTok xác
-- nhận. Hàm `ensureNoBrand()` tự bịa ra một bản ghi thương hiệu mang id đó và đặt tên
-- "No brand"; người dùng chọn nó, template lưu id đó, và TikTok — khi nhận `brand_id` này —
-- phân giải nó thành thương hiệu THẬT sở hữu id ấy trong hệ thống của họ.
--
-- Bằng chứng trong chính database này: sau khi đồng bộ 15.145 thương hiệu từ TikTok, bản ghi
-- đó vẫn còn `is_system = true` — nghĩa là `Get Brands` của TikTok CHƯA BAO GIỜ trả về nó.
--
-- Migration này làm ba việc, không mất dữ liệu:
--   1. Thêm `brand_mode` để "No brand" trở thành một trạng thái có tên, không còn phải mượn
--      NULL hay mượn một id bịa.
--   2. Chuyển mọi template đang trỏ vào id bịa sang `NONE` và xoá id đó khỏi template.
--   3. Gỡ danh tính "No brand" giả khỏi bản ghi thương hiệu để nó không được chọn lại.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Enum + cột
-- ---------------------------------------------------------------------------
CREATE TYPE "pod_brand_mode" AS ENUM ('UNSET', 'NONE', 'SPECIFIC');

ALTER TABLE "pod_category_templates"
  ADD COLUMN "brand_mode" "pod_brand_mode" NOT NULL DEFAULT 'UNSET';

ALTER TABLE "pod_listing_templates"
  ADD COLUMN "brand_mode" "pod_brand_mode" NOT NULL DEFAULT 'UNSET';

-- ---------------------------------------------------------------------------
-- 2) Backfill — đọc ý định CŨ từ dữ liệu đang có
--
-- Thứ tự quan trọng: đánh dấu SPECIFIC trước cho mọi template có brand, rồi mới hạ những
-- template trỏ vào "No brand" xuống NONE. Làm ngược lại thì bước SPECIFIC sẽ ghi đè NONE.
-- ---------------------------------------------------------------------------
UPDATE "pod_category_templates" SET "brand_mode" = 'SPECIFIC' WHERE "tiktok_brand_id" IS NOT NULL;
UPDATE "pod_listing_templates"  SET "brand_mode" = 'SPECIFIC' WHERE "tiktok_brand_id" IS NOT NULL;

-- 2a) Template trỏ vào id BỊA ⇒ đúng ra người dùng đã chọn "No brand".
--     Xoá luôn id: giữ lại chỉ chờ ngày có ai đó đọc nhầm nó thành brand thật.
UPDATE "pod_category_templates"
SET "brand_mode" = 'NONE', "tiktok_brand_id" = NULL, "brand_name" = 'No brand'
WHERE "tiktok_brand_id" = '7082427311584347905';

UPDATE "pod_listing_templates"
SET "brand_mode" = 'NONE', "tiktok_brand_id" = NULL, "brand_name" = 'No brand'
WHERE "tiktok_brand_id" = '7082427311584347905';

-- 2b) Phòng xa: template trỏ vào BẤT KỲ bản ghi nào đang được đánh dấu là "No brand"
--     (kể cả một ngày TikTok trả về "No brand" thật). Người dùng chọn nó cũng là chọn
--     "không gắn thương hiệu" — ý định giống hệt, nên xử lý giống hệt.
UPDATE "pod_category_templates" t
SET "brand_mode" = 'NONE', "tiktok_brand_id" = NULL, "brand_name" = 'No brand'
FROM "pod_product_brands" b
WHERE b."tiktok_brand_id" = t."tiktok_brand_id" AND b."is_no_brand" = true;

UPDATE "pod_listing_templates" t
SET "brand_mode" = 'NONE', "tiktok_brand_id" = NULL, "brand_name" = 'No brand'
FROM "pod_product_brands" b
WHERE b."tiktok_brand_id" = t."tiktok_brand_id" AND b."is_no_brand" = true;

-- ---------------------------------------------------------------------------
-- 3) Gỡ danh tính "No brand" GIẢ khỏi bảng thương hiệu
--
-- 🔴 KHÔNG xoá bản ghi: `pod_products.brand_id` đang trỏ vào nó (những sản phẩm mà TikTok
-- báo về là thuộc thương hiệu này — chúng THẬT SỰ mang thương hiệu đó trên sàn). Xoá đi là
-- mất liên kết có thật.
--
-- Chỉ gỡ hai thứ khiến nó bị hiểu nhầm:
--   `is_no_brand = false` ⇒ giao diện thôi chào nó như lựa chọn "No brand";
--   `name = NULL`         ⇒ không còn khẳng định một cái tên mà TikTok chưa từng xác nhận.
-- `is_system = true` giữ nguyên để thấy rõ đây là bản ghi do hệ thống tạo, không phải từ sàn.
-- ---------------------------------------------------------------------------
UPDATE "pod_product_brands"
SET "is_no_brand" = false, "name" = NULL
WHERE "tiktok_brand_id" = '7082427311584347905' AND "is_system" = true;
