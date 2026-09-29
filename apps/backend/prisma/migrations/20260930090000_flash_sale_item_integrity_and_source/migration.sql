-- Flash Sale — giữ nguyên dòng sản phẩm/biến thể, và đánh dấu nguồn của đợt sale.
--
-- 1. 🔴 ROOT CAUSE "duplicate thiếu product/variant":
--    `pod_flash_sale_items.variant_id` trỏ `pod_product_variants` với ON DELETE CASCADE, còn
--    lượt đồng bộ sản phẩm (trước bản sửa này) XOÁ RỒI TẠO LẠI mọi biến thể mỗi lần sản phẩm
--    đổi trên TikTok. Mỗi lần như vậy PostgreSQL xoá luôn các dòng Flash Sale của sản phẩm đó —
--    không log, không lỗi. Dữ liệu thật: một đợt đã publish 600 SKU chỉ còn 36 dòng, và bản
--    Duplicate chỉ chép được phần còn sót.
--
--    Sửa hai tầng:
--      · lượt đồng bộ sản phẩm nay UPSERT biến thể theo (product_id, tiktok_sku_id) — id biến
--        thể giữ nguyên (xem PodProductRepository.upsertAggregate);
--      · SKU bị người bán xoá thật trên TikTok ⇒ FK nay là SET NULL: dòng Flash Sale VẪN CÒN
--        (giữ `provider_variant_id` + `sku_id` đã chụp), validator báo lỗi rõ ràng thay vì dòng
--        biến mất trong im lặng.
--
-- 2. Partial unique index mức PRODUCT phải bỏ qua dòng mức VARIATION vừa mất `variant_id`
--    (chúng vẫn còn `provider_variant_id`). Không sửa thì hai SKU cùng sản phẩm bị xoá sẽ đâm
--    vào nhau ở index này và làm hỏng cả lượt đồng bộ sản phẩm.
--
-- 3. `source` — đợt sale do hệ thống tạo (SYSTEM) hay đồng bộ về từ TikTok (TIKTOK).
--
-- 4. Sửa dữ liệu: `item_count` đang lệch với số dòng thật (hậu quả của mục 1).
--    Dữ liệu đã mất KHÔNG khôi phục được — migration chỉ làm cho con số nói đúng sự thật.

-- 1. FK biến thể: CASCADE ⇒ SET NULL
ALTER TABLE "pod_flash_sale_items" DROP CONSTRAINT "pod_flash_sale_items_variant_id_fkey";
ALTER TABLE "pod_flash_sale_items"
  ADD CONSTRAINT "pod_flash_sale_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "pod_product_variants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Chống trùng mức PRODUCT — chỉ những dòng THỰC SỰ ở mức sản phẩm
DROP INDEX "pod_flash_sale_items_product_level_key";
CREATE UNIQUE INDEX "pod_flash_sale_items_product_level_key"
  ON "pod_flash_sale_items" ("flash_sale_id", "product_id")
  WHERE "variant_id" IS NULL AND "provider_variant_id" IS NULL;

-- 3. Nguồn của đợt sale
ALTER TABLE "pod_flash_sales"
  ADD COLUMN "source" VARCHAR(16) NOT NULL DEFAULT 'SYSTEM';

-- Tra nhanh đợt sale theo (shop, nguồn) — màn hình lọc "đồng bộ từ TikTok".
CREATE INDEX "pod_flash_sales_shop_id_source_idx" ON "pod_flash_sales" ("shop_id", "source");

-- 4. Đếm lại số dòng thật
UPDATE "pod_flash_sales" f
SET "item_count" = (
  SELECT count(*) FROM "pod_flash_sale_items" i
  WHERE i."flash_sale_id" = f."id" AND i."status" <> 'REMOVED'
);
