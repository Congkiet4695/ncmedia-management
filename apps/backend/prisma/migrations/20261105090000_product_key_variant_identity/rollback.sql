-- Rollback THỦ CÔNG của 20261105090000_product_key_variant_identity (Prisma không tự chạy file này). Gỡ code trước.
--
-- Script TỰ DỪNG nếu sau migration đã có nhiều bản ghi cùng Seller SKU (đã khai riêng từng biến thể): khoá cũ không biểu
-- diễn được chúng và chọn giữ bản nào là quyết định nghiệp vụ. Khi đó phải xử lý tay các bản ghi được liệt kê.
-- Sau khi rollback, nhớ xoá dòng của migration này khỏi bảng _prisma_migrations.

BEGIN;

DO $$
DECLARE conflicts INTEGER;
BEGIN
  SELECT COUNT(*) INTO conflicts FROM (
    SELECT 1 FROM "fulfillment_product_mappings"
    WHERE "deleted_at" IS NULL AND "seller_sku" IS NOT NULL AND "tiktok_product_id" IS NOT NULL
    GROUP BY "organization_id", "tiktok_product_id", "seller_sku" HAVING COUNT(*) > 1
    UNION ALL
    SELECT 1 FROM "fulfillment_product_designs"
    WHERE "deleted_at" IS NULL AND "seller_sku" IS NOT NULL AND "tiktok_product_id" IS NOT NULL
    GROUP BY "organization_id", "tiktok_product_id", "seller_sku", "placement" HAVING COUNT(*) > 1
  ) duplicated;
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Không thể rollback: % khoá Seller SKU đã có nhiều bản ghi theo biến thể. Xử lý tay trước.', conflicts;
  END IF;
END $$;

ALTER TABLE "fulfillment_product_mappings" DROP CONSTRAINT "fulfillment_product_mappings_variant_key_check";
ALTER TABLE "fulfillment_product_designs" DROP CONSTRAINT "fulfillment_product_designs_variant_key_check";
DROP INDEX "fulfillment_product_mappings_variant_unique";
DROP INDEX "fulfillment_product_designs_variant_unique";
DROP INDEX "fulfillment_product_mappings_legacy_unique";
DROP INDEX "fulfillment_product_designs_legacy_unique";

-- Design theo Seller SKU không mang SKU ID ở mô hình cũ. Ánh xạ giữ tiktok_sku_id vì ở mô hình cũ đó là cột tham chiếu.
UPDATE "fulfillment_product_designs" SET "tiktok_sku_id" = NULL WHERE "seller_sku" IS NOT NULL;

ALTER TABLE "fulfillment_product_mappings" DROP COLUMN "legacy_shared_key";
ALTER TABLE "fulfillment_product_designs" DROP COLUMN "legacy_shared_key";

CREATE UNIQUE INDEX "fulfillment_product_mappings_product_sku_unique"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "seller_sku")
  WHERE "deleted_at" IS NULL AND "tiktok_product_id" IS NOT NULL AND "seller_sku" IS NOT NULL;
CREATE UNIQUE INDEX "fulfillment_product_mappings_product_sku_id_unique"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "tiktok_sku_id")
  WHERE "deleted_at" IS NULL AND "seller_sku" IS NULL AND "tiktok_product_id" IS NOT NULL AND "tiktok_sku_id" IS NOT NULL;
CREATE UNIQUE INDEX "fulfillment_product_designs_active_unique"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "seller_sku", "placement")
  WHERE "deleted_at" IS NULL AND "tiktok_product_id" IS NOT NULL AND "seller_sku" IS NOT NULL;
CREATE UNIQUE INDEX "fulfillment_product_designs_active_sku_id_unique"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "tiktok_sku_id", "placement")
  WHERE "deleted_at" IS NULL AND "seller_sku" IS NULL AND "tiktok_product_id" IS NOT NULL AND "tiktok_sku_id" IS NOT NULL;

COMMIT;
