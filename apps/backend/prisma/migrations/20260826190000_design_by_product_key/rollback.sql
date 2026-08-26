-- ============================================================================
-- ROLLBACK cho migration 20260826190000_design_by_product_key
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f prisma/migrations/20260826190000_design_by_product_key/rollback.sql
--   psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20260826190000_design_by_product_key';"
--   -- rồi đưa code backend về commit trước đó (schema.prisma phải khớp với DB).
--
-- KHÔI PHỤC ĐƯỢC: cấu trúc cũ và `mapping_id` của MỌI design mà cặp khoá của nó còn tìm được
-- một Product Mapping đang sống. Dữ liệu design (file, version, lịch sử) không mất dòng nào.
--
-- KHÔNG khôi phục được: design của những sản phẩm CHƯA có Product Mapping — chúng chỉ tồn tại
-- được nhờ chính thay đổi này. Rollback sẽ để `mapping_id` NULL cho các dòng đó, và bản cũ
-- của backend (vốn bắt buộc mapping_id NOT NULL) sẽ không đọc được chúng.
-- ⚠️ CHẠY PHẦN KIỂM TRA Ở BƯỚC 0 TRƯỚC. Có dòng nào không suy được mapping thì phải quyết
-- định xử lý chúng trước khi rollback, chứ không để lệnh tự chạy tiếp.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. KIỂM TRA TRƯỚC — bao nhiêu design sẽ mất liên kết?
-- ---------------------------------------------------------------------------
DO $$
DECLARE orphan_count INTEGER;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM "fulfillment_product_designs" d
  WHERE d."deleted_at" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "fulfillment_product_mappings" m
      WHERE m."deleted_at"        IS NULL
        AND m."organization_id"   = d."organization_id"
        AND m."tiktok_product_id" = d."tiktok_product_id"
        AND m."seller_sku"        = d."seller_sku"
    );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'DUNG ROLLBACK: % design dang song thuoc san pham CHUA co Product Mapping. Mo hinh cu khong bieu dien duoc chung. Hay khai Product Mapping cho nhung san pham do truoc, hoac xoa dong nay de chap nhan mat lien ket.',
      orphan_count;
  END IF;
END $$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Trả lại cột mapping_id và suy ngược từ cặp khoá
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_designs"
  ADD COLUMN IF NOT EXISTS "mapping_id" UUID;

UPDATE "fulfillment_product_designs" d
SET "mapping_id" = m."id"
FROM "fulfillment_product_mappings" m
WHERE m."deleted_at"        IS NULL
  AND m."organization_id"   = d."organization_id"
  AND m."tiktok_product_id" = d."tiktok_product_id"
  AND m."seller_sku"        = d."seller_sku";

-- Dòng không suy được (đã bị bước 0 chặn, trừ khi vận hành cố tình bỏ qua) phải rời đi:
-- cột cũ là NOT NULL nên không thể giữ chúng lại.
DELETE FROM "fulfillment_product_designs" WHERE "mapping_id" IS NULL;

ALTER TABLE "fulfillment_product_designs" ALTER COLUMN "mapping_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Bỏ ràng buộc/chỉ mục của mô hình mới
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_designs"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_designs_identity_check";

DROP INDEX IF EXISTS "fulfillment_product_designs_active_unique";
DROP INDEX IF EXISTS "fulfillment_product_designs_organization_id_tiktok_produ_idx";

ALTER TABLE "fulfillment_product_designs"
  DROP COLUMN IF EXISTS "tiktok_product_id",
  DROP COLUMN IF EXISTS "seller_sku";

-- ---------------------------------------------------------------------------
-- 3. Dựng lại cấu trúc cũ
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_designs"
  RENAME CONSTRAINT "fulfillment_product_designs_storage_file_id_fkey"
  TO "fulfillment_mapping_designs_storage_file_id_fkey";

ALTER TABLE "fulfillment_product_designs" RENAME TO "fulfillment_mapping_designs";

ALTER INDEX "fulfillment_product_designs_pkey"
  RENAME TO "fulfillment_mapping_designs_pkey";
ALTER INDEX "fulfillment_product_designs_organization_id_idx"
  RENAME TO "fulfillment_mapping_designs_organization_id_idx";

CREATE INDEX "fulfillment_mapping_designs_mapping_id_placement_idx"
  ON "fulfillment_mapping_designs" ("mapping_id", "placement");

CREATE UNIQUE INDEX "fulfillment_mapping_designs_active_unique"
  ON "fulfillment_mapping_designs" ("mapping_id", "placement")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "fulfillment_mapping_designs"
  ADD CONSTRAINT "fulfillment_mapping_designs_mapping_id_fkey"
  FOREIGN KEY ("mapping_id") REFERENCES "fulfillment_product_mappings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "fulfillment_mapping_designs" IS NULL;

COMMIT;
