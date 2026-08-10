-- CreateEnum
CREATE TYPE "fulfillment_provider" AS ENUM ('MANGOTEE', 'PRINTIFY', 'PRINTFUL');

-- CreateEnum
CREATE TYPE "fulfillment_status" AS ENUM ('DRAFT', 'SUBMITTING', 'SUBMITTED', 'IN_PRODUCTION', 'ON_HOLD', 'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "fulfillment_event_type" AS ENUM ('CREATE_REQUEST', 'CREATE_SUCCESS', 'CREATE_FAILED', 'STATUS_CHANGED', 'SHIPMENT_UPDATED', 'SYNC', 'CANCEL_REQUEST', 'CANCEL_SUCCESS', 'CANCEL_FAILED', 'RETRY', 'WEBHOOK_RECEIVED', 'VALIDATION_FAILED');

-- CreateEnum
CREATE TYPE "fulfillment_trigger" AS ENUM ('MANUAL', 'CRON', 'WEBHOOK', 'RETRY');

-- CreateTable
CREATE TABLE "fulfillment_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "api_key_enc" TEXT NOT NULL,
    "api_key_hint" VARCHAR(8),
    "base_url_override" VARCHAR(500),
    "default_production_line" VARCHAR(64),
    "default_shipping_method" VARCHAR(40) NOT NULL DEFAULT 'standard',
    "default_facility" VARCHAR(40),
    "webhook_secret_enc" TEXT,
    "provider_webhook_id" VARCHAR(64),
    "last_used_at" TIMESTAMPTZ(6),
    "last_error_at" TIMESTAMPTZ(6),
    "last_error_msg" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fulfillment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_product_mappings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "tiktok_product_id" VARCHAR(64),
    "tiktok_sku_id" VARCHAR(64),
    "seller_sku" VARCHAR(255),
    "provider_sku" VARCHAR(255) NOT NULL,
    "provider_product_id" VARCHAR(64),
    "provider_variant_id" VARCHAR(64),
    "provider_product_name" VARCHAR(500),
    "provider_color" VARCHAR(100),
    "provider_size" VARCHAR(100),
    "production_config" VARCHAR(40),
    "production_line" VARCHAR(64),
    "placement_map" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fulfillment_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "fulfillment_provider" NOT NULL,
    "pod_order_id" UUID NOT NULL,
    "external_order_id" VARCHAR(40) NOT NULL,
    "provider_order_id" VARCHAR(64),
    "provider_fulfill_id" VARCHAR(64),
    "status" "fulfillment_status" NOT NULL DEFAULT 'DRAFT',
    "provider_status" VARCHAR(64),
    "production_line" VARCHAR(64),
    "shipping_method" VARCHAR(40),
    "facility" VARCHAR(40),
    "speed_type" VARCHAR(40),
    "tracking_number" VARCHAR(128),
    "tracking_status" VARCHAR(64),
    "tracking_url" VARCHAR(1024),
    "carrier" VARCHAR(100),
    "label_url" VARCHAR(1024),
    "subtotal" DECIMAL(18,4),
    "shipping_fee" DECIMAL(18,4),
    "tax" DECIMAL(18,4),
    "total" DECIMAL(18,4),
    "currency" VARCHAR(10),
    "raw_request" JSONB,
    "raw_response" JSONB,
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(2000),
    "last_request_id" VARCHAR(64),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "fulfillment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_order_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fulfillment_order_id" UUID NOT NULL,
    "pod_order_item_id" UUID,
    "provider_sku" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "provider_item_id" VARCHAR(64),
    "production_config" VARCHAR(40),
    "print_files" JSONB,
    "base_cost" DECIMAL(18,4),
    "color" VARCHAR(100),
    "size" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fulfillment_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_histories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fulfillment_order_id" UUID NOT NULL,
    "event_type" "fulfillment_event_type" NOT NULL,
    "trigger" "fulfillment_trigger" NOT NULL,
    "from_status" "fulfillment_status",
    "to_status" "fulfillment_status",
    "provider_status" VARCHAR(64),
    "success" BOOLEAN NOT NULL DEFAULT true,
    "message" VARCHAR(2000),
    "payload" JSONB,
    "duration_ms" INTEGER,
    "request_id" VARCHAR(64),
    "performed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_error_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fulfillment_order_id" UUID,
    "provider" "fulfillment_provider" NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "error_class" VARCHAR(40) NOT NULL,
    "http_status" INTEGER,
    "provider_code" VARCHAR(64),
    "message" VARCHAR(2000) NOT NULL,
    "validation_errors" JSONB,
    "raw_error" JSONB,
    "request_id" VARCHAR(64),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_webhook_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "account_id" UUID,
    "provider" "fulfillment_provider" NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "external_order_id" VARCHAR(64),
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "dead_letter" BOOLEAN NOT NULL DEFAULT false,
    "error_message" VARCHAR(2000),
    "fulfillment_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_sync_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID,
    "provider" "fulfillment_provider" NOT NULL,
    "trigger" "fulfillment_trigger" NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "orders_checked" INTEGER NOT NULL DEFAULT 0,
    "orders_updated" INTEGER NOT NULL DEFAULT 0,
    "orders_failed" INTEGER NOT NULL DEFAULT 0,
    "api_calls" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(2000),
    "triggered_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fulfillment_accounts_organization_id_provider_idx" ON "fulfillment_accounts"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "fulfillment_accounts_is_active_idx" ON "fulfillment_accounts"("is_active");

-- CreateIndex
CREATE INDEX "fulfillment_product_mappings_organization_id_provider_idx" ON "fulfillment_product_mappings"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "fulfillment_product_mappings_organization_id_tiktok_sku_id_idx" ON "fulfillment_product_mappings"("organization_id", "tiktok_sku_id");

-- CreateIndex
CREATE INDEX "fulfillment_product_mappings_organization_id_seller_sku_idx" ON "fulfillment_product_mappings"("organization_id", "seller_sku");

-- CreateIndex
CREATE INDEX "fulfillment_product_mappings_organization_id_tiktok_product_idx" ON "fulfillment_product_mappings"("organization_id", "tiktok_product_id");

-- CreateIndex
CREATE INDEX "fulfillment_product_mappings_account_id_idx" ON "fulfillment_product_mappings"("account_id");

-- CreateIndex
CREATE INDEX "fulfillment_orders_organization_id_status_idx" ON "fulfillment_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "fulfillment_orders_account_id_idx" ON "fulfillment_orders"("account_id");

-- CreateIndex
CREATE INDEX "fulfillment_orders_provider_order_id_idx" ON "fulfillment_orders"("provider_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_orders_last_synced_at_idx" ON "fulfillment_orders"("last_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_orders_pod_order_id_provider_key" ON "fulfillment_orders"("pod_order_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_orders_organization_id_external_order_id_key" ON "fulfillment_orders"("organization_id", "external_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_order_items_fulfillment_order_id_idx" ON "fulfillment_order_items"("fulfillment_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_order_items_organization_id_idx" ON "fulfillment_order_items"("organization_id");

-- CreateIndex
CREATE INDEX "fulfillment_order_items_pod_order_item_id_idx" ON "fulfillment_order_items"("pod_order_item_id");

-- CreateIndex
CREATE INDEX "fulfillment_histories_fulfillment_order_id_created_at_idx" ON "fulfillment_histories"("fulfillment_order_id", "created_at");

-- CreateIndex
CREATE INDEX "fulfillment_histories_organization_id_created_at_idx" ON "fulfillment_histories"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "fulfillment_histories_event_type_idx" ON "fulfillment_histories"("event_type");

-- CreateIndex
CREATE INDEX "fulfillment_error_logs_organization_id_created_at_idx" ON "fulfillment_error_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "fulfillment_error_logs_fulfillment_order_id_idx" ON "fulfillment_error_logs"("fulfillment_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_error_logs_error_class_idx" ON "fulfillment_error_logs"("error_class");

-- CreateIndex
CREATE INDEX "fulfillment_webhook_logs_provider_event_type_idx" ON "fulfillment_webhook_logs"("provider", "event_type");

-- CreateIndex
CREATE INDEX "fulfillment_webhook_logs_processed_dead_letter_idx" ON "fulfillment_webhook_logs"("processed", "dead_letter");

-- CreateIndex
CREATE INDEX "fulfillment_webhook_logs_external_order_id_idx" ON "fulfillment_webhook_logs"("external_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_webhook_logs_created_at_idx" ON "fulfillment_webhook_logs"("created_at");

-- CreateIndex
CREATE INDEX "fulfillment_sync_logs_organization_id_started_at_idx" ON "fulfillment_sync_logs"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "fulfillment_sync_logs_status_idx" ON "fulfillment_sync_logs"("status");

-- AddForeignKey
ALTER TABLE "fulfillment_accounts" ADD CONSTRAINT "fulfillment_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_product_mappings" ADD CONSTRAINT "fulfillment_product_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_product_mappings" ADD CONSTRAINT "fulfillment_product_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_pod_order_id_fkey" FOREIGN KEY ("pod_order_id") REFERENCES "pod_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "fulfillment_order_items_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "fulfillment_order_items_pod_order_item_id_fkey" FOREIGN KEY ("pod_order_item_id") REFERENCES "pod_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_histories" ADD CONSTRAINT "fulfillment_histories_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_error_logs" ADD CONSTRAINT "fulfillment_error_logs_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_webhook_logs" ADD CONSTRAINT "fulfillment_webhook_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_webhook_logs" ADD CONSTRAINT "fulfillment_webhook_logs_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_sync_logs" ADD CONSTRAINT "fulfillment_sync_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fulfillment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Ràng buộc toàn vẹn — hàng rào cuối cùng ở tầng DB, không phụ thuộc tầng ứng dụng.
-- ---------------------------------------------------------------------------

-- Ánh xạ sản phẩm phải có ÍT NHẤT MỘT khoá phía TikTok, nếu không sẽ không bao giờ khớp.
ALTER TABLE "fulfillment_product_mappings"
  ADD CONSTRAINT "fulfillment_product_mappings_key_check"
  CHECK (
    "tiktok_product_id" IS NOT NULL
    OR "tiktok_sku_id" IS NOT NULL
    OR "seller_sku" IS NOT NULL
  );

-- SKU phía nhà cung cấp không được rỗng (gửi rỗng sẽ bị Mango từ chối).
ALTER TABLE "fulfillment_product_mappings"
  ADD CONSTRAINT "fulfillment_product_mappings_sku_check"
  CHECK (length(btrim("provider_sku")) > 0);

-- Số lượng gửi đi phải dương.
ALTER TABLE "fulfillment_order_items"
  ADD CONSTRAINT "fulfillment_order_items_quantity_check" CHECK ("quantity" > 0);

-- Số lần thử không âm.
ALTER TABLE "fulfillment_orders"
  ADD CONSTRAINT "fulfillment_orders_attempt_check" CHECK ("attempt_count" >= 0);
ALTER TABLE "fulfillment_webhook_logs"
  ADD CONSTRAINT "fulfillment_webhook_logs_attempt_check" CHECK ("attempt_count" >= 0);

-- Mango yêu cầu `order_id` DUY NHẤT toàn hệ thống của họ; ta cũng chặn rỗng từ phía mình.
ALTER TABLE "fulfillment_orders"
  ADD CONSTRAINT "fulfillment_orders_external_id_check"
  CHECK (length(btrim("external_order_id")) > 0);

-- Chỉ MỘT tài khoản mặc định cho mỗi (organization, provider).
-- Dùng partial unique index vì `is_default = false` thì được phép trùng nhau.
CREATE UNIQUE INDEX "fulfillment_accounts_default_uniq"
  ON "fulfillment_accounts" ("organization_id", "provider")
  WHERE "is_default" = true AND "deleted_at" IS NULL;
