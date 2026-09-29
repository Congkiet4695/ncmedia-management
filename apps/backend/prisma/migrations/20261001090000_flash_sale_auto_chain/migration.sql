-- Auto Flash Sale: chuỗi các đợt nối tiếp (A → B → C …) + lịch chạy theo tổ chức.

-- AlterEnum
ALTER TYPE "pod_flash_sale_log_action" ADD VALUE 'AUTO_CHAIN';

-- AlterTable
ALTER TABLE "pod_flash_sales" ADD COLUMN     "auto_chain_id" UUID,
ADD COLUMN     "auto_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "auto_parent_id" UUID,
ADD COLUMN     "auto_sequence" INTEGER;

ALTER TABLE "pod_flash_sales"
  ADD CONSTRAINT "pod_flash_sales_auto_sequence_check" CHECK ("auto_sequence" IS NULL OR "auto_sequence" >= 1),
  -- Bật Auto thì bắt buộc thuộc một chuỗi.
  ADD CONSTRAINT "pod_flash_sales_auto_mode_chain_check" CHECK (NOT "auto_mode" OR "auto_chain_id" IS NOT NULL);

-- CreateTable
CREATE TABLE "pod_flash_sale_auto_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "run_time" VARCHAR(5) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "last_scheduled_at" TIMESTAMPTZ(6),
    "last_run_at" TIMESTAMPTZ(6),
    "last_run_trigger" VARCHAR(16),
    "last_run_status" VARCHAR(16),
    "last_run_summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_flash_sale_auto_configs_pkey" PRIMARY KEY ("id"),
    -- `HH:mm` 24 giờ.
    CONSTRAINT "pod_flash_sale_auto_configs_run_time_check" CHECK ("run_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

-- CreateIndex
CREATE UNIQUE INDEX "pod_flash_sale_auto_configs_organization_id_key" ON "pod_flash_sale_auto_configs"("organization_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_auto_configs_enabled_idx" ON "pod_flash_sale_auto_configs"("enabled");

-- CreateIndex
CREATE INDEX "pod_flash_sales_auto_chain_id_idx" ON "pod_flash_sales"("auto_chain_id");

-- CreateIndex
CREATE INDEX "pod_flash_sales_auto_parent_id_idx" ON "pod_flash_sales"("auto_parent_id");

-- AddForeignKey
ALTER TABLE "pod_flash_sales" ADD CONSTRAINT "pod_flash_sales_auto_parent_id_fkey" FOREIGN KEY ("auto_parent_id") REFERENCES "pod_flash_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 🔴 Chống trùng Ở DATABASE (Prisma chưa khai báo được partial unique):
-- mỗi đợt có TỐI ĐA MỘT đợt kế tiếp còn sống. Hai lượt cron cùng tạo B ⇒ lượt sau vỡ ràng buộc.
CREATE UNIQUE INDEX "pod_flash_sales_auto_parent_live_key"
  ON "pod_flash_sales" ("auto_parent_id")
  WHERE "auto_parent_id" IS NOT NULL AND "deleted_at" IS NULL;

-- Mỗi chuỗi có ĐÚNG MỘT đợt đang bật Auto.
CREATE UNIQUE INDEX "pod_flash_sales_auto_chain_active_key"
  ON "pod_flash_sales" ("auto_chain_id")
  WHERE "auto_mode" AND "deleted_at" IS NULL;

-- Truy vấn của job: đợt đang bật Auto của một tổ chức, sắp theo giờ kết thúc.
CREATE INDEX "pod_flash_sales_auto_due_idx"
  ON "pod_flash_sales" ("organization_id", "end_at")
  WHERE "auto_mode" AND "deleted_at" IS NULL;
