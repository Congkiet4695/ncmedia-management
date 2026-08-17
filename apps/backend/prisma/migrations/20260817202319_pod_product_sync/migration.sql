-- CreateEnum
CREATE TYPE "pod_product_sync_scope" AS ENUM ('FULL', 'INCREMENTAL', 'SINGLE');

-- CreateEnum
CREATE TYPE "pod_product_sync_trigger" AS ENUM ('MANUAL', 'SCHEDULER');

-- CreateEnum
CREATE TYPE "pod_product_sync_status" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "pod_product_sync_action" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "pod_product_raw_source" AS ENUM ('SEARCH', 'DETAIL');

-- AlterTable
ALTER TABLE "pod_tiktok_shops" ADD COLUMN     "product_sync_cursor" BIGINT,
ADD COLUMN     "product_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "product_sync_failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "product_synced_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "pod_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_product_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(1024),
    "description" TEXT,
    "status" VARCHAR(40),
    "audit_status" VARCHAR(40),
    "brand_id" UUID,
    "tiktok_brand_id" VARCHAR(64),
    "brand_name" VARCHAR(255),
    "category_id" UUID,
    "tiktok_category_id" VARCHAR(64),
    "category_name" VARCHAR(255),
    "category_path" VARCHAR(1024),
    "package_length" VARCHAR(32),
    "package_width" VARCHAR(32),
    "package_height" VARCHAR(32),
    "dimension_unit" VARCHAR(16),
    "package_weight" VARCHAR(32),
    "weight_unit" VARCHAR(16),
    "is_not_for_sale" BOOLEAN NOT NULL DEFAULT false,
    "has_draft" BOOLEAN NOT NULL DEFAULT false,
    "listing_quality_tier" VARCHAR(40),
    "product_tags" JSONB,
    "sales_regions" JSONB,
    "product_types" JSONB,
    "sku_count" INTEGER NOT NULL DEFAULT 0,
    "min_price" DECIMAL(18,4),
    "max_price" DECIMAL(18,4),
    "currency" VARCHAR(10),
    "total_inventory" INTEGER NOT NULL DEFAULT 0,
    "tiktok_create_time" BIGINT,
    "tiktok_update_time" BIGINT,
    "tiktok_created_at" TIMESTAMPTZ(6),
    "tiktok_updated_at" TIMESTAMPTZ(6),
    "payload_hash" CHAR(64) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "tiktok_sku_id" VARCHAR(64) NOT NULL,
    "seller_sku" VARCHAR(255),
    "external_sku_id" VARCHAR(255),
    "variant_name" VARCHAR(512),
    "sales_attributes" JSONB,
    "sale_price" DECIMAL(18,4),
    "list_price" DECIMAL(18,4),
    "tax_exclusive_price" DECIMAL(18,4),
    "currency" VARCHAR(10),
    "inventory_total" INTEGER NOT NULL DEFAULT 0,
    "inventory" JSONB,
    "sku_weight" VARCHAR(32),
    "weight_unit" VARCHAR(16),
    "sku_length" VARCHAR(32),
    "sku_width" VARCHAR(32),
    "sku_height" VARCHAR(32),
    "dimension_unit" VARCHAR(16),
    "status" VARCHAR(40),
    "image_url" VARCHAR(2048),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_images" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "uri" VARCHAR(512),
    "url" VARCHAR(2048),
    "thumb_url" VARCHAR(2048),
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_videos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "tiktok_video_id" VARCHAR(128),
    "url" VARCHAR(2048),
    "cover_url" VARCHAR(2048),
    "format" VARCHAR(20),
    "width" INTEGER,
    "height" INTEGER,
    "size" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_product_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_attributes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "tiktok_attribute_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255),
    "values" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_category_id" VARCHAR(64) NOT NULL,
    "parent_tiktok_id" VARCHAR(64),
    "local_name" VARCHAR(255),
    "is_leaf" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER NOT NULL DEFAULT 0,
    "path" VARCHAR(1024),
    "permission_statuses" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pod_product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_category_attributes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "tiktok_attribute_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255),
    "type" VARCHAR(40),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_multiple_selection" BOOLEAN NOT NULL DEFAULT false,
    "is_customizable" BOOLEAN NOT NULL DEFAULT false,
    "value_data_format" VARCHAR(40),
    "values" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_brands" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_brand_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255),
    "authorized_status" VARCHAR(40),
    "brand_status" VARCHAR(40),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pod_product_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_sync_histories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID,
    "scope" "pod_product_sync_scope" NOT NULL,
    "trigger" "pod_product_sync_trigger" NOT NULL,
    "status" "pod_product_sync_status" NOT NULL DEFAULT 'RUNNING',
    "watermark_from" BIGINT,
    "watermark_to" BIGINT,
    "products_fetched" INTEGER NOT NULL DEFAULT 0,
    "products_created" INTEGER NOT NULL DEFAULT 0,
    "products_updated" INTEGER NOT NULL DEFAULT 0,
    "products_skipped" INTEGER NOT NULL DEFAULT 0,
    "products_failed" INTEGER NOT NULL DEFAULT 0,
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "api_calls" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(2000),
    "tiktok_request_id" VARCHAR(64),
    "triggered_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_product_sync_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_sync_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "history_id" UUID NOT NULL,
    "product_id" UUID,
    "tiktok_product_id" VARCHAR(64) NOT NULL,
    "action" "pod_product_sync_action" NOT NULL,
    "message" VARCHAR(1000),
    "error_code" VARCHAR(64),
    "tiktok_request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_product_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_product_raw_data" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_id" UUID,
    "tiktok_product_id" VARCHAR(64) NOT NULL,
    "source" "pod_product_raw_source" NOT NULL,
    "api_version" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "tiktok_request_id" VARCHAR(64),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_product_raw_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_products_organization_id_idx" ON "pod_products"("organization_id");

-- CreateIndex
CREATE INDEX "pod_products_account_id_idx" ON "pod_products"("account_id");

-- CreateIndex
CREATE INDEX "pod_products_shop_id_status_idx" ON "pod_products"("shop_id", "status");

-- CreateIndex
CREATE INDEX "pod_products_organization_id_tiktok_update_time_idx" ON "pod_products"("organization_id", "tiktok_update_time");

-- CreateIndex
CREATE INDEX "pod_products_category_id_idx" ON "pod_products"("category_id");

-- CreateIndex
CREATE INDEX "pod_products_brand_id_idx" ON "pod_products"("brand_id");

-- CreateIndex
CREATE INDEX "pod_products_title_idx" ON "pod_products"("title");

-- CreateIndex
CREATE UNIQUE INDEX "pod_products_shop_id_tiktok_product_id_key" ON "pod_products"("shop_id", "tiktok_product_id");

-- CreateIndex
CREATE INDEX "pod_product_variants_organization_id_idx" ON "pod_product_variants"("organization_id");

-- CreateIndex
CREATE INDEX "pod_product_variants_product_id_idx" ON "pod_product_variants"("product_id");

-- CreateIndex
CREATE INDEX "pod_product_variants_tiktok_sku_id_idx" ON "pod_product_variants"("tiktok_sku_id");

-- CreateIndex
CREATE INDEX "pod_product_variants_seller_sku_idx" ON "pod_product_variants"("seller_sku");

-- CreateIndex
CREATE UNIQUE INDEX "pod_product_variants_product_id_tiktok_sku_id_key" ON "pod_product_variants"("product_id", "tiktok_sku_id");

-- CreateIndex
CREATE INDEX "pod_product_images_organization_id_idx" ON "pod_product_images"("organization_id");

-- CreateIndex
CREATE INDEX "pod_product_images_product_id_idx" ON "pod_product_images"("product_id");

-- CreateIndex
CREATE INDEX "pod_product_images_variant_id_idx" ON "pod_product_images"("variant_id");

-- CreateIndex
CREATE INDEX "pod_product_videos_organization_id_idx" ON "pod_product_videos"("organization_id");

-- CreateIndex
CREATE INDEX "pod_product_videos_product_id_idx" ON "pod_product_videos"("product_id");

-- CreateIndex
CREATE INDEX "pod_product_attributes_organization_id_idx" ON "pod_product_attributes"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_product_attributes_product_id_tiktok_attribute_id_key" ON "pod_product_attributes"("product_id", "tiktok_attribute_id");

-- CreateIndex
CREATE INDEX "pod_product_categories_organization_id_idx" ON "pod_product_categories"("organization_id");

-- CreateIndex
CREATE INDEX "pod_product_categories_shop_id_is_leaf_idx" ON "pod_product_categories"("shop_id", "is_leaf");

-- CreateIndex
CREATE INDEX "pod_product_categories_parent_tiktok_id_idx" ON "pod_product_categories"("parent_tiktok_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_product_categories_shop_id_tiktok_category_id_key" ON "pod_product_categories"("shop_id", "tiktok_category_id");

-- CreateIndex
CREATE INDEX "pod_category_attributes_organization_id_idx" ON "pod_category_attributes"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_category_attributes_category_id_tiktok_attribute_id_key" ON "pod_category_attributes"("category_id", "tiktok_attribute_id");

-- CreateIndex
CREATE INDEX "pod_product_brands_organization_id_idx" ON "pod_product_brands"("organization_id");

-- CreateIndex
CREATE INDEX "pod_product_brands_name_idx" ON "pod_product_brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pod_product_brands_shop_id_tiktok_brand_id_key" ON "pod_product_brands"("shop_id", "tiktok_brand_id");

-- CreateIndex
CREATE INDEX "pod_product_sync_histories_organization_id_started_at_idx" ON "pod_product_sync_histories"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "pod_product_sync_histories_account_id_started_at_idx" ON "pod_product_sync_histories"("account_id", "started_at");

-- CreateIndex
CREATE INDEX "pod_product_sync_histories_status_idx" ON "pod_product_sync_histories"("status");

-- CreateIndex
CREATE INDEX "pod_product_sync_logs_history_id_idx" ON "pod_product_sync_logs"("history_id");

-- CreateIndex
CREATE INDEX "pod_product_sync_logs_organization_id_created_at_idx" ON "pod_product_sync_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "pod_product_sync_logs_tiktok_product_id_idx" ON "pod_product_sync_logs"("tiktok_product_id");

-- CreateIndex
CREATE INDEX "pod_product_sync_logs_action_idx" ON "pod_product_sync_logs"("action");

-- CreateIndex
CREATE INDEX "pod_product_raw_data_organization_id_idx" ON "pod_product_raw_data"("organization_id");

-- CreateIndex
CREATE INDEX "pod_product_raw_data_product_id_idx" ON "pod_product_raw_data"("product_id");

-- CreateIndex
CREATE INDEX "pod_product_raw_data_fetched_at_idx" ON "pod_product_raw_data"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_product_raw_data_shop_id_tiktok_product_id_source_key" ON "pod_product_raw_data"("shop_id", "tiktok_product_id", "source");

-- AddForeignKey
ALTER TABLE "pod_products" ADD CONSTRAINT "pod_products_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_products" ADD CONSTRAINT "pod_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_products" ADD CONSTRAINT "pod_products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "pod_product_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_products" ADD CONSTRAINT "pod_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "pod_product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_variants" ADD CONSTRAINT "pod_product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_images" ADD CONSTRAINT "pod_product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_images" ADD CONSTRAINT "pod_product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "pod_product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_videos" ADD CONSTRAINT "pod_product_videos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_attributes" ADD CONSTRAINT "pod_product_attributes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_categories" ADD CONSTRAINT "pod_product_categories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_category_attributes" ADD CONSTRAINT "pod_category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "pod_product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_brands" ADD CONSTRAINT "pod_product_brands_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_sync_histories" ADD CONSTRAINT "pod_product_sync_histories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_sync_histories" ADD CONSTRAINT "pod_product_sync_histories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_sync_logs" ADD CONSTRAINT "pod_product_sync_logs_history_id_fkey" FOREIGN KEY ("history_id") REFERENCES "pod_product_sync_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_sync_logs" ADD CONSTRAINT "pod_product_sync_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_product_raw_data" ADD CONSTRAINT "pod_product_raw_data_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
