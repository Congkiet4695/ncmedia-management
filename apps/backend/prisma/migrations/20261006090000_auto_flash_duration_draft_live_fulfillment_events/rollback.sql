-- Rollback 20261006090000_auto_flash_duration_draft_live_fulfillment_events (chạy tay, sau đó xoá dòng
-- tương ứng trong _prisma_migrations).
--
-- ⚠️ PostgreSQL không xoá được giá trị khỏi ENUM: các giá trị mới của "fulfillment_event_type" được GIỮ
-- (vô hại với code phiên bản trước — nó chỉ không ghi chúng). Lịch sử đã ghi với các giá trị đó vẫn còn.
ALTER TABLE "pod_listing_payloads" DROP COLUMN IF EXISTS "went_live_at";
ALTER TABLE "pod_flash_sale_auto_configs" DROP COLUMN IF EXISTS "duration";
ALTER TABLE "pod_flash_sale_auto_configs" DROP COLUMN IF EXISTS "duration_mode";
DROP TYPE IF EXISTS "pod_flash_sale_auto_duration";
DROP TYPE IF EXISTS "pod_flash_sale_auto_duration_mode";
