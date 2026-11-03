-- Khoá sản phẩm dự phòng cho biến thể KHÔNG có Seller SKU trên TikTok (quyết định PO 2026-11-03).
--
-- Trước đây Product Mapping và Design BẮT BUỘC (tiktok_product_id, seller_sku) — CHECK identity_check — nên biến thể
-- TikTok không có Seller SKU (cả đơn lẫn danh mục Products) không khai được ánh xạ / design và đơn không fulfill được.
-- Nay: khoá chính vẫn là (product, seller_sku); khi seller_sku TRỐNG thì danh tính là (product, tiktok_sku_id) — id
-- biến thể do TikTok cấp, ổn định. KHÔNG sinh Seller SKU giả, không ghi đè dữ liệu TikTok.
--
-- Chỉ THÊM: một cột NULL-able, nới CHECK (mọi bản ghi hiện có đều thoả cả CHECK cũ lẫn mới), hai partial unique index
-- chỉ áp cho bản ghi seller_sku IS NULL (hiện không có bản ghi nào như vậy) ⇒ không đổi / không xoá dữ liệu.
-- CHECK giữ NOT VALID như migration 20260826170000 / 20260826190000 (bản ghi cũ thiếu khoá vẫn được giữ nguyên).
--
-- Rollback (chỉ khi chưa có bản ghi seller_sku IS NULL nào được tạo, sau khi gỡ code):
--   DROP INDEX "fulfillment_product_mappings_product_sku_id_unique";
--   DROP INDEX "fulfillment_product_designs_active_sku_id_unique";
--   DROP INDEX "fulfillment_product_designs_org_product_sku_id_idx";
--   ALTER TABLE "fulfillment_product_mappings" DROP CONSTRAINT "fulfillment_product_mappings_identity_check";
--   ALTER TABLE "fulfillment_product_mappings" ADD CONSTRAINT "fulfillment_product_mappings_identity_check"
--     CHECK ("tiktok_product_id" IS NOT NULL AND "seller_sku" IS NOT NULL) NOT VALID;
--   ALTER TABLE "fulfillment_product_designs" DROP CONSTRAINT "fulfillment_product_designs_identity_check";
--   ALTER TABLE "fulfillment_product_designs" ADD CONSTRAINT "fulfillment_product_designs_identity_check"
--     CHECK ("tiktok_product_id" IS NOT NULL AND "seller_sku" IS NOT NULL) NOT VALID;
--   ALTER TABLE "fulfillment_product_designs" DROP COLUMN "tiktok_sku_id";

-- ---------------------------------------------------------------------------
-- 1. Product Mapping (cột tiktok_sku_id đã có sẵn)
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_mappings"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_mappings_identity_check";
ALTER TABLE "fulfillment_product_mappings"
  ADD CONSTRAINT "fulfillment_product_mappings_identity_check"
  CHECK ("tiktok_product_id" IS NOT NULL AND ("seller_sku" IS NOT NULL OR "tiktok_sku_id" IS NOT NULL))
  NOT VALID;

-- Mỗi biến thể không có Seller SKU chỉ có MỘT ánh xạ đang sống (bổ sung cho _product_sku_unique của khoá Seller SKU).
CREATE UNIQUE INDEX "fulfillment_product_mappings_product_sku_id_unique"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "tiktok_sku_id")
  WHERE "deleted_at" IS NULL
    AND "seller_sku" IS NULL
    AND "tiktok_product_id" IS NOT NULL
    AND "tiktok_sku_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Design
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_designs" ADD COLUMN "tiktok_sku_id" VARCHAR(64);

ALTER TABLE "fulfillment_product_designs"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_designs_identity_check";
ALTER TABLE "fulfillment_product_designs"
  ADD CONSTRAINT "fulfillment_product_designs_identity_check"
  CHECK ("tiktok_product_id" IS NOT NULL AND ("seller_sku" IS NOT NULL OR "tiktok_sku_id" IS NOT NULL))
  NOT VALID;

-- Mỗi (biến thể không có Seller SKU × vị trí in) chỉ có MỘT design đang sống — như _active_unique của khoá Seller SKU.
CREATE UNIQUE INDEX "fulfillment_product_designs_active_sku_id_unique"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "tiktok_sku_id", "placement")
  WHERE "deleted_at" IS NULL
    AND "seller_sku" IS NULL
    AND "tiktok_product_id" IS NOT NULL
    AND "tiktok_sku_id" IS NOT NULL;

CREATE INDEX "fulfillment_product_designs_org_product_sku_id_idx"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "tiktok_sku_id");
