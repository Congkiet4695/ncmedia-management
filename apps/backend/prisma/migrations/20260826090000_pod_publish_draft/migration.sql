-- Sprint 5 — Publish Draft lên TikTok Shop
--
-- Draft đã nằm trên TikTok (save_mode = AS_DRAFT) được đưa vào hàng chờ duyệt bằng
-- Edit Product (save_mode = LISTING). TikTok KHÔNG cấp product_id mới, nên migration này
-- không tạo bảng mới: nó mở rộng đúng hai bảng đang mang vòng đời của một listing.

-- 1. Lượt chạy làm gì với TikTok -------------------------------------------------------
CREATE TYPE "pod_listing_job_type" AS ENUM ('CREATE_DRAFT', 'PUBLISH');

ALTER TABLE "pod_listing_jobs"
  ADD COLUMN "type" "pod_listing_job_type" NOT NULL DEFAULT 'CREATE_DRAFT';

CREATE INDEX "pod_listing_jobs_organization_id_type_created_at_idx"
  ON "pod_listing_jobs" ("organization_id", "type", "created_at");

-- 2. Bước mới trong pipeline ------------------------------------------------------------
ALTER TYPE "pod_listing_step" ADD VALUE IF NOT EXISTS 'PUBLISH';
ALTER TYPE "pod_listing_step" ADD VALUE IF NOT EXISTS 'REVIEW_SYNC';

-- 3. Trạng thái duyệt phía TikTok --------------------------------------------------------
CREATE TYPE "pod_listing_review_status" AS ENUM (
  'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE', 'OFFLINE', 'DELETED'
);

ALTER TABLE "pod_listing_payloads"
  ADD COLUMN "tiktok_draft_id"      VARCHAR(64),
  ADD COLUMN "publish_retry_count"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publish_request"      JSONB,
  ADD COLUMN "publish_response"     JSONB,
  ADD COLUMN "review_status"        "pod_listing_review_status",
  ADD COLUMN "review_status_raw"    VARCHAR(64),
  ADD COLUMN "review_reason"        VARCHAR(2000),
  ADD COLUMN "review_checked_at"    TIMESTAMPTZ(6);

CREATE INDEX "pod_listing_payloads_review_status_review_checked_at_idx"
  ON "pod_listing_payloads" ("review_status", "review_checked_at");

-- 4. Backfill ---------------------------------------------------------------------------
-- Mọi draft đã tạo trên TikTok trước sprint này đều mang id của bản Draft: chép sang cột
-- mới để cổng "đã có draft ⇒ KHÔNG Create lại" chặn được ngay từ lượt publish đầu tiên.
UPDATE "pod_listing_payloads"
   SET "tiktok_draft_id" = "tiktok_product_id"
 WHERE "tiktok_product_id" IS NOT NULL
   AND "tiktok_draft_id" IS NULL;
