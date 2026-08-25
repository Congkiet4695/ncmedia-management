-- Sprint 4 — Bulk Listing Engine.
--
-- Ba bảng cho một lượt đưa hàng loạt sản phẩm lên TikTok dưới dạng DRAFT:
--   pod_listing_jobs       — một lượt chạy (tên, thị trường, template, tiến độ, thời lượng)
--   pod_listing_job_items  — một (sản phẩm × shop): trạng thái, remote_product_id, retry, lỗi
--   pod_listing_logs       — nhật ký từng bước của từng item (merge/validate/upload/create)
--
-- Không đụng tới bảng nào đang có: draft listing vẫn là nơi lưu payload đã giải, job chỉ
-- trỏ tới nó qua draft_listing_id.
-- CreateEnum
CREATE TYPE "pod_listing_job_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "pod_listing_job_item_status" AS ENUM ('PENDING', 'PROCESSING', 'RETRYING', 'SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "pod_listing_log_level" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "pod_listing_step" AS ENUM ('LOAD_PRODUCT', 'LOAD_TEMPLATE', 'MERGE', 'VALIDATE', 'UPLOAD_IMAGE', 'CREATE_DRAFT', 'SAVE_REMOTE_ID', 'RETRY', 'CANCEL');

-- CreateTable
CREATE TABLE "pod_listing_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "market" "pod_listing_market" NOT NULL,
    "status" "pod_listing_job_status" NOT NULL DEFAULT 'PENDING',
    "listing_template_id" UUID NOT NULL,
    "image_template_id" UUID,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "success_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "concurrency" INTEGER NOT NULL DEFAULT 5,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_listing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_job_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "listing_template_id" UUID NOT NULL,
    "draft_listing_id" UUID,
    "status" "pod_listing_job_item_status" NOT NULL DEFAULT 'PENDING',
    "remote_product_id" VARCHAR(64),
    "error" VARCHAR(2000),
    "error_code" VARCHAR(64),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_listing_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "listing_item_id" UUID,
    "level" "pod_listing_log_level" NOT NULL DEFAULT 'INFO',
    "step" "pod_listing_step" NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_listing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_listing_jobs_organization_id_status_idx" ON "pod_listing_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_listing_jobs_organization_id_created_at_idx" ON "pod_listing_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "pod_listing_job_items_organization_id_status_idx" ON "pod_listing_job_items"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_listing_job_items_job_id_status_idx" ON "pod_listing_job_items"("job_id", "status");

-- CreateIndex
CREATE INDEX "pod_listing_job_items_status_next_attempt_at_idx" ON "pod_listing_job_items"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_listing_job_items_job_id_product_id_shop_id_key" ON "pod_listing_job_items"("job_id", "product_id", "shop_id");

-- CreateIndex
CREATE INDEX "pod_listing_logs_organization_id_idx" ON "pod_listing_logs"("organization_id");

-- CreateIndex
CREATE INDEX "pod_listing_logs_job_id_created_at_idx" ON "pod_listing_logs"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "pod_listing_logs_listing_item_id_created_at_idx" ON "pod_listing_logs"("listing_item_id", "created_at");

-- AddForeignKey
ALTER TABLE "pod_listing_jobs" ADD CONSTRAINT "pod_listing_jobs_listing_template_id_fkey" FOREIGN KEY ("listing_template_id") REFERENCES "pod_listing_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_jobs" ADD CONSTRAINT "pod_listing_jobs_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "pod_listing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_listing_template_id_fkey" FOREIGN KEY ("listing_template_id") REFERENCES "pod_listing_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_logs" ADD CONSTRAINT "pod_listing_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "pod_listing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_logs" ADD CONSTRAINT "pod_listing_logs_listing_item_id_fkey" FOREIGN KEY ("listing_item_id") REFERENCES "pod_listing_job_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

