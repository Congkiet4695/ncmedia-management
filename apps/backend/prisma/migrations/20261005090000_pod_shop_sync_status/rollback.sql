-- Rollback 20261005090000_pod_shop_sync_status (chạy tay, sau đó xoá dòng tương ứng trong _prisma_migrations).
--
-- ⚠️ LỊCH SỬ đồng bộ đã bị bỏ theo yêu cầu — KHÔNG khôi phục được. Rollback chỉ dựng lại CẤU TRÚC bảng cũ
-- (rỗng) để code phiên bản trước chạy được: chạy lại phần CREATE TABLE / INDEX / FOREIGN KEY của
--   - "pod_sync_logs"               trong migrations/20260806072226_pod_tiktok_orders_sync/migration.sql
--   - "pod_product_sync_histories"  trong migrations/20260817202319_pod_product_sync/migration.sql
--   - "pod_product_sync_logs"       trong migrations/20260817202319_pod_product_sync/migration.sql
-- (cùng các ALTER TABLE thêm cột về sau của ba bảng này, nếu có), rồi:

DROP TABLE IF EXISTS "pod_shop_sync_statuses";
DROP TYPE IF EXISTS "pod_shop_sync_type";
