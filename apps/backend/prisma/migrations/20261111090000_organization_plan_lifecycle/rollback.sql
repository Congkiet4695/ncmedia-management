-- Hoàn tác thủ công migration 20261111090000_organization_plan_lifecycle.
-- Giá trị enum đã thêm KHÔNG gỡ được trong PostgreSQL (không ảnh hưởng gì nếu không dùng) — giữ lại.
-- Trước khi chạy: deploy lại code không còn đọc shop_limit / expires_at / organization_deletion_logs.
DROP TABLE IF EXISTS "organization_deletion_logs";
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_shop_limit_positive";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "shop_limit", DROP COLUMN IF EXISTS "expires_at";
