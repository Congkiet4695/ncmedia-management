-- CreateEnum
CREATE TYPE "pod_sync_trigger" AS ENUM ('CRON', 'MANUAL', 'BACKFILL');

-- CreateEnum
CREATE TYPE "pod_sync_status" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "pod_tiktok_shops" ADD COLUMN     "backfill_done" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sync_failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sync_paused_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "pod_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_order_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "buyer_user_id" VARCHAR(64),
    "buyer_email" VARCHAR(255),
    "buyer_nickname" VARCHAR(255),
    "buyer_message" TEXT,
    "seller_note" TEXT,
    "cancellation_initiator" VARCHAR(20),
    "cancel_reason" VARCHAR(500),
    "is_buyer_request_cancel" BOOLEAN NOT NULL DEFAULT false,
    "fulfillment_type" VARCHAR(40),
    "delivery_type" VARCHAR(30),
    "shipping_type" VARCHAR(30),
    "shipping_provider" VARCHAR(255),
    "shipping_provider_id" VARCHAR(64),
    "tracking_number" VARCHAR(255),
    "split_or_combine_tag" VARCHAR(20),
    "has_updated_recipient_address" BOOLEAN NOT NULL DEFAULT false,
    "warehouse_id" VARCHAR(64),
    "delivery_option_id" VARCHAR(64),
    "delivery_option_name" VARCHAR(255),
    "payment_method_name" VARCHAR(100),
    "need_upload_invoice" VARCHAR(30),
    "is_cod" BOOLEAN NOT NULL DEFAULT false,
    "order_type" VARCHAR(30),
    "handling_duration_days" VARCHAR(10),
    "handling_duration_type" VARCHAR(20),
    "release_date" BIGINT,
    "is_on_hold_order" BOOLEAN NOT NULL DEFAULT false,
    "is_sample_order" BOOLEAN NOT NULL DEFAULT false,
    "is_replacement_order" BOOLEAN NOT NULL DEFAULT false,
    "replaced_order_id" VARCHAR(64),
    "is_exchange_order" BOOLEAN NOT NULL DEFAULT false,
    "exchange_source_order_id" VARCHAR(64),
    "is_subscription_order" BOOLEAN NOT NULL DEFAULT false,
    "commerce_platform" VARCHAR(30),
    "auto_combine_group_id" VARCHAR(64),
    "fast_delivery_program" VARCHAR(40),
    "currency" VARCHAR(10),
    "total_amount" DECIMAL(18,4),
    "sub_total" DECIMAL(18,4),
    "shipping_fee" DECIMAL(18,4),
    "original_total_product_price" DECIMAL(18,4),
    "original_shipping_fee" DECIMAL(18,4),
    "seller_discount" DECIMAL(18,4),
    "platform_discount" DECIMAL(18,4),
    "payment_platform_discount" DECIMAL(18,4),
    "payment_discount_service_fee" DECIMAL(18,4),
    "shipping_fee_seller_discount" DECIMAL(18,4),
    "shipping_fee_platform_discount" DECIMAL(18,4),
    "shipping_fee_cofunded_discount" DECIMAL(18,4),
    "tax" DECIMAL(18,4),
    "product_tax" DECIMAL(18,4),
    "shipping_fee_tax" DECIMAL(18,4),
    "retail_delivery_fee" DECIMAL(18,4),
    "buyer_service_fee" DECIMAL(18,4),
    "handling_fee" DECIMAL(18,4),
    "shipping_insurance_fee" DECIMAL(18,4),
    "item_insurance_fee" DECIMAL(18,4),
    "item_insurance_tax" DECIMAL(18,4),
    "small_order_fee" DECIMAL(18,4),
    "recipient_enc" TEXT,
    "recipient_region_code" VARCHAR(10),
    "recipient_postal_code" VARCHAR(20),
    "recipient_masked" BOOLEAN NOT NULL DEFAULT false,
    "tiktok_create_time" BIGINT NOT NULL,
    "tiktok_update_time" BIGINT NOT NULL,
    "paid_time" BIGINT,
    "rts_time" BIGINT,
    "cancel_time" BIGINT,
    "delivery_time" BIGINT,
    "collection_time" BIGINT,
    "request_cancel_time" BIGINT,
    "rts_sla_time" BIGINT,
    "tts_sla_time" BIGINT,
    "delivery_sla_time" BIGINT,
    "cancel_order_sla_time" BIGINT,
    "shipping_due_time" BIGINT,
    "collection_due_time" BIGINT,
    "delivery_due_time" BIGINT,
    "ordered_at" TIMESTAMPTZ(6) NOT NULL,
    "tiktok_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "has_pod_item" BOOLEAN NOT NULL DEFAULT false,
    "sync_source" VARCHAR(20) NOT NULL,
    "sync_version" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_order_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "tiktok_line_item_id" VARCHAR(64) NOT NULL,
    "product_id" VARCHAR(64),
    "product_name" VARCHAR(1024),
    "sku_id" VARCHAR(64),
    "sku_name" VARCHAR(512),
    "seller_sku" VARCHAR(255),
    "sku_image" VARCHAR(2048),
    "sale_price" DECIMAL(18,4),
    "original_price" DECIMAL(18,4),
    "platform_discount" DECIMAL(18,4),
    "seller_discount" DECIMAL(18,4),
    "currency" VARCHAR(10),
    "display_status" VARCHAR(40),
    "package_status" VARCHAR(40),
    "package_id" VARCHAR(64),
    "tracking_number" VARCHAR(255),
    "shipping_provider_id" VARCHAR(64),
    "shipping_provider_name" VARCHAR(255),
    "warehouse_id" VARCHAR(64),
    "cancel_reason" VARCHAR(500),
    "cancel_user" VARCHAR(20),
    "rts_time" BIGINT,
    "is_gift" BOOLEAN NOT NULL DEFAULT false,
    "is_dangerous_good" BOOLEAN NOT NULL DEFAULT false,
    "needs_prescription" BOOLEAN NOT NULL DEFAULT false,
    "is_pod_customized" BOOLEAN NOT NULL DEFAULT false,
    "pod_info_id" VARCHAR(64),
    "sku_type" VARCHAR(40),
    "product_listing_type" VARCHAR(40),
    "room_id" VARCHAR(64),
    "retail_delivery_fee" DECIMAL(18,4),
    "buyer_service_fee" DECIMAL(18,4),
    "small_order_fee" DECIMAL(18,4),
    "pfand_fee" DECIMAL(18,4),
    "gift_retail_price" DECIMAL(18,4),
    "is_unboxing_item" BOOLEAN NOT NULL DEFAULT false,
    "unboxing_sku_code" VARCHAR(64),
    "item_tax" JSONB,
    "sub_item_info" JSONB,
    "combined_listing_skus" JSONB,
    "unboxing_case_list" JSONB,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_order_packages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "tiktok_package_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_order_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_sync_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID,
    "shop_id" UUID,
    "trigger" "pod_sync_trigger" NOT NULL,
    "status" "pod_sync_status" NOT NULL DEFAULT 'RUNNING',
    "window_from" BIGINT,
    "window_to" BIGINT,
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "api_calls" INTEGER NOT NULL DEFAULT 0,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "error_code" VARCHAR(40),
    "error_message" VARCHAR(1000),
    "tiktok_request_id" VARCHAR(64),
    "triggered_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_orders_organization_id_idx" ON "pod_orders"("organization_id");

-- CreateIndex
CREATE INDEX "pod_orders_shop_id_tiktok_update_time_idx" ON "pod_orders"("shop_id", "tiktok_update_time");

-- CreateIndex
CREATE INDEX "pod_orders_account_id_idx" ON "pod_orders"("account_id");

-- CreateIndex
CREATE INDEX "pod_orders_status_idx" ON "pod_orders"("status");

-- CreateIndex
CREATE INDEX "pod_orders_organization_id_ordered_at_idx" ON "pod_orders"("organization_id", "ordered_at");

-- CreateIndex
CREATE INDEX "pod_orders_has_pod_item_idx" ON "pod_orders"("has_pod_item");

-- CreateIndex
CREATE INDEX "pod_orders_order_type_idx" ON "pod_orders"("order_type");

-- CreateIndex
CREATE UNIQUE INDEX "pod_orders_organization_id_tiktok_order_id_key" ON "pod_orders"("organization_id", "tiktok_order_id");

-- CreateIndex
CREATE INDEX "pod_order_items_organization_id_idx" ON "pod_order_items"("organization_id");

-- CreateIndex
CREATE INDEX "pod_order_items_order_id_idx" ON "pod_order_items"("order_id");

-- CreateIndex
CREATE INDEX "pod_order_items_sku_id_idx" ON "pod_order_items"("sku_id");

-- CreateIndex
CREATE INDEX "pod_order_items_is_pod_customized_idx" ON "pod_order_items"("is_pod_customized");

-- CreateIndex
CREATE INDEX "pod_order_items_package_id_idx" ON "pod_order_items"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_order_items_order_id_tiktok_line_item_id_key" ON "pod_order_items"("order_id", "tiktok_line_item_id");

-- CreateIndex
CREATE INDEX "pod_order_packages_organization_id_idx" ON "pod_order_packages"("organization_id");

-- CreateIndex
CREATE INDEX "pod_order_packages_order_id_idx" ON "pod_order_packages"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_order_packages_order_id_tiktok_package_id_key" ON "pod_order_packages"("order_id", "tiktok_package_id");

-- CreateIndex
CREATE INDEX "pod_sync_logs_organization_id_started_at_idx" ON "pod_sync_logs"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "pod_sync_logs_shop_id_started_at_idx" ON "pod_sync_logs"("shop_id", "started_at");

-- CreateIndex
CREATE INDEX "pod_sync_logs_account_id_started_at_idx" ON "pod_sync_logs"("account_id", "started_at");

-- CreateIndex
CREATE INDEX "pod_sync_logs_status_idx" ON "pod_sync_logs"("status");

-- AddForeignKey
ALTER TABLE "pod_orders" ADD CONSTRAINT "pod_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_orders" ADD CONSTRAINT "pod_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_order_items" ADD CONSTRAINT "pod_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pod_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_order_packages" ADD CONSTRAINT "pod_order_packages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pod_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sync_logs" ADD CONSTRAINT "pod_sync_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sync_logs" ADD CONSTRAINT "pod_sync_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (Prisma schema khong bieu dien duoc)
-- ---------------------------------------------------------------------------

-- Watermark dong bo va cac moc thoi gian Unix khong am.
ALTER TABLE "pod_orders"
  ADD CONSTRAINT "pod_orders_time_check"
  CHECK ("tiktok_create_time" >= 0 AND "tiktok_update_time" >= 0);

-- Bo dem phien ban dong bo khong am.
ALTER TABLE "pod_orders"
  ADD CONSTRAINT "pod_orders_sync_version_check"
  CHECK ("sync_version" >= 0);

-- Nguon ghi hop le (khop enum PodSyncTrigger phia ung dung).
ALTER TABLE "pod_orders"
  ADD CONSTRAINT "pod_orders_sync_source_check"
  CHECK ("sync_source" IN ('CRON', 'MANUAL', 'BACKFILL'));

-- Cac bo dem cua sync log khong am.
ALTER TABLE "pod_sync_logs"
  ADD CONSTRAINT "pod_sync_logs_counters_check"
  CHECK ("pages_fetched" >= 0 AND "api_calls" >= 0 AND "total_orders" >= 0
     AND "created_count" >= 0 AND "updated_count" >= 0
     AND "skipped_count" >= 0 AND "failed_count" >= 0);

-- Bo dem loi sync theo shop khong am.
ALTER TABLE "pod_tiktok_shops"
  ADD CONSTRAINT "pod_tiktok_shops_sync_failure_count_check"
  CHECK ("sync_failure_count" >= 0);
