-- ============================================================================
-- ROLLBACK cho migration 20260826170000_design_by_product_sku
--
-- Prisma Migrate không có bước "down" — file này chạy THỦ CÔNG bằng psql khi cần lùi:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f prisma/migrations/20260826170000_design_by_product_sku/rollback.sql
--   -- rồi gỡ dòng migration khỏi bảng lịch sử của Prisma:
--   psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20260826170000_design_by_product_sku';"
--   -- và đưa code backend về commit trước đó (schema.prisma phải khớp với DB).
--
-- PHẢI ĐỌC TRƯỚC KHI CHẠY
--   Rollback KHÔI PHỤC được: cấu trúc (index, constraint, cột base_cost) và các bản ghi ánh
--   xạ đã bị gộp ở bước 3 — chúng chỉ bị XOÁ MỀM nên đảo lại là đủ.
--   Rollback KHÔNG khôi phục: nội dung base_cost đã nhập (cột bị DROP), và không xoá những
--   dòng fulfillment_mapping_designs được chép mới ở bước 5 — cố tình như vậy, vì xoá chúng
--   sẽ làm mất design của những sản phẩm mà người vận hành đã dùng sau khi migrate. Thừa một
--   bộ design đúng thì vô hại; thiếu thì đơn ra xưởng in không có file.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Trả lại ràng buộc/chỉ mục cũ
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_mappings"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_mappings_identity_check";

ALTER TABLE "fulfillment_product_mappings"
  ADD CONSTRAINT "fulfillment_product_mappings_key_check"
  CHECK ("tiktok_product_id" IS NOT NULL
      OR "tiktok_sku_id" IS NOT NULL
      OR "seller_sku" IS NOT NULL)
  NOT VALID;

DROP INDEX IF EXISTS "fulfillment_product_mappings_product_sku_unique";
DROP INDEX IF EXISTS "fulfillment_product_mappings_organization_id_tiktok_produc_idx";

CREATE INDEX IF NOT EXISTS "fulfillment_product_mappings_organization_id_tiktok_sku_id_idx"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_sku_id");
CREATE INDEX IF NOT EXISTS "fulfillment_product_mappings_organization_id_tiktok_product_idx"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id");

-- ---------------------------------------------------------------------------
-- 2. Phục hồi các ánh xạ đã bị gộp ở bước 3
--
-- Nhận diện bằng dấu vết migration để lại trong `note` — không đoán mò theo thời gian xoá.
-- Phải chạy TRƯỚC khi dựng lại unique index cũ, vì bản phục hồi có thể trùng seller_sku.
-- ---------------------------------------------------------------------------
UPDATE "fulfillment_mapping_designs" d
SET "deleted_at" = NULL
FROM "fulfillment_product_mappings" m
WHERE d."mapping_id" = m."id"
  AND m."note" LIKE '%migration 20260826170000%'
  AND d."deleted_at" IS NOT NULL;

UPDATE "fulfillment_product_mappings"
SET "deleted_at" = NULL,
    "is_active"  = true,
    "note"       = NULLIF(regexp_replace("note", '( \| )?Gop vao anh xa [0-9a-f-]+ \(migration 20260826170000[^)]*\)', ''), '')
WHERE "note" LIKE '%migration 20260826170000%';

CREATE UNIQUE INDEX IF NOT EXISTS "fulfillment_product_mappings_seller_sku_unique"
  ON "fulfillment_product_mappings" ("organization_id", "account_id", "seller_sku")
  WHERE "deleted_at" IS NULL AND "seller_sku" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Bỏ cột Base Cost
--
-- Dữ liệu trong cột này MẤT khi rollback. Muốn giữ, chạy trước:
--   CREATE TABLE base_cost_backup AS
--     SELECT id, base_cost FROM fulfillment_product_mappings WHERE base_cost IS NOT NULL;
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_mappings" DROP COLUMN IF EXISTS "base_cost";

-- ---------------------------------------------------------------------------
-- 4. Bảng lưu trữ trở lại trạng thái không chú thích
-- ---------------------------------------------------------------------------
COMMENT ON TABLE "pod_order_item_designs" IS NULL;

COMMIT;
