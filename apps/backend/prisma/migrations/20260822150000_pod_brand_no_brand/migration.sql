-- ===========================================================================
-- "No brand" là một lựa chọn HỢP LỆ của TikTok, không phải "để trống".
--
-- Seller Center luôn có mục "No brand" trong ô Brand, và hàng POD gần như luôn dùng nó.
-- Trước đây hệ thống chỉ lưu những brand mà API trả về, nên nếu API không liệt kê thì
-- Category Template không có gì để chọn — và listing không đăng được vì cổng validate
-- đòi brand_id.
--
-- Hai cột mới:
--   is_no_brand — đánh dấu bản ghi "No brand" (đừng so tên ở mỗi chỗ dùng: tên hiển thị
--                 đổi theo ngôn ngữ và theo lần đồng bộ, cờ này thì không).
--   is_system   — bản ghi do hệ thống tự tạo vì API không trả về. Lần đồng bộ sau TikTok
--                 trả về thật thì bản ghi được cập nhật tại chỗ và cờ tắt đi.
-- ===========================================================================
-- AlterTable
ALTER TABLE "pod_product_brands" ADD COLUMN     "is_no_brand" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "pod_product_brands_organization_id_is_no_brand_idx" ON "pod_product_brands"("organization_id", "is_no_brand");


-- Đánh dấu ngay những bản ghi "No brand" mà TikTok ĐÃ trả về ở các lần đồng bộ trước.
-- So khớp bỏ dấu cách và không phân biệt hoa thường: "No Brand", "no brand", "NoBrand".
UPDATE "pod_product_brands"
SET "is_no_brand" = true
WHERE lower(replace("name", ' ', '')) = 'nobrand';
