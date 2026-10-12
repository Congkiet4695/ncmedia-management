-- Return & Refund (TikTok scope seller.return_refund.basic) — CHỈ THÊM: bảng mới, cột mới (có mặc định),
-- giá trị enum mới. Không đổi / xoá dữ liệu POD Order, finance hay notification hiện có.

-- CreateEnum
CREATE TYPE "pod_return_status_group" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'OTHER');

-- AlterEnum
ALTER TYPE "notification_entity_type" ADD VALUE 'POD_RETURN_REQUEST';

-- AlterEnum
ALTER TYPE "notification_event_type" ADD VALUE 'RETURN_REFUND_REQUEST';

-- AlterEnum
ALTER TYPE "pod_shop_sync_type" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "organization_notification_preferences" ADD COLUMN     "notify_return_refund" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "pod_tiktok_shops" ADD COLUMN     "last_return_sync_cursor" BIGINT;

-- CreateTable
CREATE TABLE "pod_return_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "order_id" UUID,
    "tiktok_return_id" VARCHAR(64) NOT NULL,
    "tiktok_order_id" VARCHAR(64) NOT NULL,
    "return_type" VARCHAR(40) NOT NULL,
    "return_status" VARCHAR(64) NOT NULL,
    "status_group" "pod_return_status_group" NOT NULL,
    "refund_completed" BOOLEAN NOT NULL DEFAULT false,
    "return_reason" VARCHAR(255),
    "return_reason_text" VARCHAR(500),
    "role" VARCHAR(20),
    "arbitration_status" VARCHAR(40),
    "seller_proposed_return_type" VARCHAR(40),
    "partial_refund_amount" DECIMAL(18,4),
    "buyer_rejected_partial_refund" BOOLEAN,
    "currency" VARCHAR(10),
    "refund_total" DECIMAL(18,4),
    "refund_subtotal" DECIMAL(18,4),
    "refund_shipping_fee" DECIMAL(18,4),
    "refund_tax" DECIMAL(18,4),
    "paid_amount" DECIMAL(18,4),
    "item_quantity" INTEGER NOT NULL DEFAULT 0,
    "return_tracking_number" VARCHAR(100),
    "return_provider_name" VARCHAR(100),
    "tiktok_create_time" BIGINT NOT NULL,
    "tiktok_update_time" BIGINT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "tiktok_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "history" JSONB,
    "history_synced_at" TIMESTAMPTZ(6),
    "history_update_time" BIGINT,
    "raw_payload" JSONB,
    "payload_hash" VARCHAR(64) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_return_request_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "return_line_item_id" VARCHAR(64) NOT NULL,
    "order_line_item_id" VARCHAR(64),
    "product_name" VARCHAR(500),
    "sku_id" VARCHAR(64),
    "sku_name" VARCHAR(255),
    "seller_sku" VARCHAR(255),
    "product_image_url" VARCHAR(1000),
    "currency" VARCHAR(10),
    "refund_total" DECIMAL(18,4),
    "refund_subtotal" DECIMAL(18,4),
    "paid_amount" DECIMAL(18,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_return_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_return_requests_organization_id_tiktok_order_id_idx" ON "pod_return_requests"("organization_id", "tiktok_order_id");

-- CreateIndex
CREATE INDEX "pod_return_requests_organization_id_requested_at_idx" ON "pod_return_requests"("organization_id", "requested_at");

-- CreateIndex
CREATE INDEX "pod_return_requests_organization_id_status_group_idx" ON "pod_return_requests"("organization_id", "status_group");

-- CreateIndex
CREATE INDEX "pod_return_requests_shop_id_tiktok_update_time_idx" ON "pod_return_requests"("shop_id", "tiktok_update_time");

-- CreateIndex
CREATE INDEX "pod_return_requests_order_id_idx" ON "pod_return_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_return_requests_organization_id_tiktok_return_id_key" ON "pod_return_requests"("organization_id", "tiktok_return_id");

-- CreateIndex
CREATE INDEX "pod_return_request_items_organization_id_order_line_item_id_idx" ON "pod_return_request_items"("organization_id", "order_line_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_return_request_items_return_request_id_return_line_item_key" ON "pod_return_request_items"("return_request_id", "return_line_item_id");

-- AddForeignKey
ALTER TABLE "pod_return_requests" ADD CONSTRAINT "pod_return_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_return_requests" ADD CONSTRAINT "pod_return_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_return_requests" ADD CONSTRAINT "pod_return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pod_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_return_request_items" ADD CONSTRAINT "pod_return_request_items_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "pod_return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

