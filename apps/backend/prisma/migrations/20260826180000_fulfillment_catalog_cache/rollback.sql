-- ============================================================================
-- ROLLBACK cho migration 20260826180000_fulfillment_catalog_cache
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f prisma/migrations/20260826180000_fulfillment_catalog_cache/rollback.sql
--   psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20260826180000_fulfillment_catalog_cache';"
--   -- rồi đưa code backend về commit trước đó (schema.prisma phải khớp với DB).
--
-- AN TOÀN: migration này chỉ THÊM bảng mới, nên rollback chỉ xoá đúng những bảng đó.
-- Không bảng nghiệp vụ nào hiện hữu bị đụng tới, kể cả `fulfillment_product_mappings` và
-- `fulfillment_mapping_designs`.
--
-- MẤT GÌ: toàn bộ bản sao danh mục nhà cung cấp và kết quả ánh xạ tự động gần nhất. Cả hai
-- đều là dữ liệu DẪN XUẤT — chạy lại Sync Job là có lại, không cần backup.
-- Product Mapping do ánh xạ tự động TẠO RA thì KHÔNG bị xoá (nằm ở bảng khác); muốn gỡ luôn
-- chúng thì chạy thêm câu lệnh ở cuối file — đọc kỹ trước khi chạy.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS "fulfillment_mapping_candidates";
DROP TABLE IF EXISTS "fulfillment_variants";
DROP TABLE IF EXISTS "fulfillment_products";
DROP TABLE IF EXISTS "fulfillment_catalogues";

DROP TYPE IF EXISTS "fulfillment_auto_map_tier";
DROP TYPE IF EXISTS "fulfillment_auto_map_status";
DROP TYPE IF EXISTS "fulfillment_catalog_item_status";

COMMIT;

-- ---------------------------------------------------------------------------
-- TUỲ CHỌN — chỉ chạy khi muốn gỡ cả các Product Mapping do máy tự tạo.
--
-- ⚠️ KHÔNG chạy nếu người vận hành đã upload Design lên những ánh xạ đó: xoá ánh xạ là mọi
-- đơn dùng nó quay về "thiếu ánh xạ". Nhận diện bằng dấu vết `note` mà ánh xạ tự động ghi.
-- Xoá MỀM (không xoá cứng) để còn khôi phục được.
-- ---------------------------------------------------------------------------
-- UPDATE "fulfillment_product_mappings"
-- SET "deleted_at" = CURRENT_TIMESTAMP, "is_active" = false
-- WHERE "note" LIKE '[auto-map]%' AND "deleted_at" IS NULL;
