-- Resource Sync — kéo Category / Brand / Warehouse / Attribute từ TikTok về cache.
--
-- Trước đây chỉ có một đường duy nhất để nạp cache: bật cờ includeCatalog khi đồng bộ
-- SẢN PHẨM. Màn hình Categories/Brands vì thế luôn trống mà không có nút nào để sửa,
-- kéo theo Template không chọn được danh mục. Hai bảng dưới đây cho mỗi tài nguyên một
-- nút Sync riêng, kèm trạng thái và nhật ký để biết vì sao hỏng.

-- CreateEnum
CREATE TYPE "pod_resource_type" AS ENUM ('CATEGORY', 'BRAND', 'WAREHOUSE', 'CATEGORY_ATTRIBUTE');

-- CreateEnum
CREATE TYPE "pod_resource_sync_status" AS ENUM ('IDLE', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "pod_resource_syncs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource" "pod_resource_type" NOT NULL,
    "status" "pod_resource_sync_status" NOT NULL DEFAULT 'IDLE',
    "last_sync_at" TIMESTAMPTZ(6),
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "last_error" VARCHAR(2000),
    "job_id" UUID,
    "last_run_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_resource_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_resource_sync_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource" "pod_resource_type" NOT NULL,
    "job_id" UUID NOT NULL,
    "status" "pod_resource_sync_status" NOT NULL,
    "shop_id" UUID,
    "shop_name" VARCHAR(255),
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(2000),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "triggered_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_resource_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_resource_syncs_organization_id_idx" ON "pod_resource_syncs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_resource_syncs_organization_id_resource_key" ON "pod_resource_syncs"("organization_id", "resource");

-- CreateIndex
CREATE INDEX "pod_resource_sync_logs_organization_id_resource_started_at_idx" ON "pod_resource_sync_logs"("organization_id", "resource", "started_at");

-- CreateIndex
CREATE INDEX "pod_resource_sync_logs_job_id_idx" ON "pod_resource_sync_logs"("job_id");

