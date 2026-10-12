-- Rollback thủ công của 20261012090000_pod_return_refund.
-- 🔴 Giá trị enum đã thêm (RETURN_REFUND_REQUEST, POD_RETURN_REQUEST, RETURN) KHÔNG gỡ được bằng
-- ALTER TYPE trong PostgreSQL; chúng vô hại khi không dùng. Xoá trước các dòng đang dùng chúng.
DELETE FROM "notification_events" WHERE "event_type" = 'RETURN_REFUND_REQUEST';
DELETE FROM "pod_shop_sync_statuses" WHERE "sync_type" = 'RETURN';
DROP TABLE IF EXISTS "pod_return_request_items";
DROP TABLE IF EXISTS "pod_return_requests";
DROP TYPE IF EXISTS "pod_return_status_group";
ALTER TABLE "organization_notification_preferences" DROP COLUMN IF EXISTS "notify_return_refund";
ALTER TABLE "pod_tiktok_shops" DROP COLUMN IF EXISTS "last_return_sync_cursor";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261012090000_pod_return_refund';
