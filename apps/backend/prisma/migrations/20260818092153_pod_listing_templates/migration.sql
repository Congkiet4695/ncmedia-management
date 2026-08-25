-- CreateEnum
CREATE TYPE "pod_listing_market" AS ENUM ('US', 'UK', 'EU', 'AU');

-- CreateEnum
CREATE TYPE "pod_image_asset_type" AS ENUM ('MAIN', 'MOCKUP', 'LIFESTYLE', 'SIZE_CHART', 'VIDEO');

-- CreateEnum
CREATE TYPE "pod_pricing_markup_type" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "pod_listing_template_item_type" AS ENUM ('CATEGORY', 'SKU', 'DESCRIPTION', 'IMAGE', 'PRICING');

-- CreateEnum
CREATE TYPE "pod_draft_listing_status" AS ENUM ('DRAFT', 'READY', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "pod_tiktok_warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "tiktok_warehouse_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255),
    "type" VARCHAR(40),
    "sub_type" VARCHAR(40),
    "effect_status" VARCHAR(40),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "region_code" VARCHAR(10),
    "address" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pod_tiktok_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_category_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "market" "pod_listing_market" NOT NULL,
    "tiktok_category_id" VARCHAR(64) NOT NULL,
    "category_name" VARCHAR(255),
    "category_path" VARCHAR(1024),
    "tiktok_brand_id" VARCHAR(64),
    "brand_name" VARCHAR(255),
    "package_weight" VARCHAR(32),
    "weight_unit" VARCHAR(16),
    "package_length" VARCHAR(32),
    "package_width" VARCHAR(32),
    "package_height" VARCHAR(32),
    "dimension_unit" VARCHAR(16),
    "size_chart_file_id" UUID,
    "video_file_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_category_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_category_template_attributes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_template_id" UUID NOT NULL,
    "tiktok_attribute_id" VARCHAR(64) NOT NULL,
    "attribute_name" VARCHAR(255),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "values" JSONB,
    "custom_value" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_category_template_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_sku_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "options" JSONB NOT NULL,
    "sku_prefix" VARCHAR(64),
    "sku_suffix" VARCHAR(64),
    "default_retail_price" DECIMAL(18,4),
    "default_list_price" DECIMAL(18,4),
    "default_quantity" INTEGER NOT NULL DEFAULT 0,
    "default_discount" DECIMAL(9,4),
    "currency" VARCHAR(10),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_sku_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_sku_template_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku_template_id" UUID NOT NULL,
    "optionValues" JSONB NOT NULL,
    "variant_name" VARCHAR(512) NOT NULL,
    "sku_code" VARCHAR(128),
    "retail_price" DECIMAL(18,4),
    "list_price" DECIMAL(18,4),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4),
    "image_file_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_sku_template_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_description_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "content_html" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_description_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_image_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_image_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_image_template_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "image_template_id" UUID NOT NULL,
    "asset_type" "pod_image_asset_type" NOT NULL,
    "file_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tiktok_image_uri" VARCHAR(512),
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_image_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_pricing_strategies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "cost" DECIMAL(18,4) NOT NULL,
    "shipping_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "markup_type" "pod_pricing_markup_type" NOT NULL DEFAULT 'PERCENT',
    "markup_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "list_price_multiplier" DECIMAL(9,4) NOT NULL DEFAULT 1,
    "discount_percent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "rounding_increment" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_pricing_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "market" "pod_listing_market" NOT NULL,
    "category_template_id" UUID,
    "sku_template_id" UUID,
    "description_template_id" UUID,
    "image_template_id" UUID,
    "pricing_strategy_id" UUID,
    "warehouse_id" UUID,
    "tiktok_brand_id" VARCHAR(64),
    "brand_name" VARCHAR(255),
    "shipping_template_id" VARCHAR(64),
    "handling_days" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_listing_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_template_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "listing_template_id" UUID NOT NULL,
    "item_type" "pod_listing_template_item_type" NOT NULL,
    "ref_id" UUID NOT NULL,
    "ref_name" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_listing_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_draft_listings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID,
    "shop_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "listing_template_id" UUID NOT NULL,
    "image_template_id" UUID,
    "market" "pod_listing_market" NOT NULL,
    "status" "pod_draft_listing_status" NOT NULL DEFAULT 'DRAFT',
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "issues" JSONB,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(1024),
    "variant_count" INTEGER NOT NULL DEFAULT 0,
    "tiktok_product_id" VARCHAR(64),
    "published_at" TIMESTAMPTZ(6),
    "publish_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_draft_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_draft_listing_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "draft_listing_id" UUID NOT NULL,
    "variant_name" VARCHAR(512) NOT NULL,
    "seller_sku" VARCHAR(255) NOT NULL,
    "optionValues" JSONB,
    "retail_price" DECIMAL(18,4),
    "list_price" DECIMAL(18,4),
    "currency" VARCHAR(10),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "image_file_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tiktok_sku_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_draft_listing_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_tiktok_warehouses_organization_id_idx" ON "pod_tiktok_warehouses"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_tiktok_warehouses_shop_id_tiktok_warehouse_id_key" ON "pod_tiktok_warehouses"("shop_id", "tiktok_warehouse_id");

-- CreateIndex
CREATE INDEX "pod_category_templates_organization_id_market_idx" ON "pod_category_templates"("organization_id", "market");

-- CreateIndex
CREATE INDEX "pod_category_templates_tiktok_category_id_idx" ON "pod_category_templates"("tiktok_category_id");

-- CreateIndex
CREATE INDEX "pod_category_template_attributes_organization_id_idx" ON "pod_category_template_attributes"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_category_template_attributes_category_template_id_tikto_key" ON "pod_category_template_attributes"("category_template_id", "tiktok_attribute_id");

-- CreateIndex
CREATE INDEX "pod_sku_templates_organization_id_idx" ON "pod_sku_templates"("organization_id");

-- CreateIndex
CREATE INDEX "pod_sku_template_variants_organization_id_idx" ON "pod_sku_template_variants"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_sku_template_variants_sku_template_id_variant_name_key" ON "pod_sku_template_variants"("sku_template_id", "variant_name");

-- CreateIndex
CREATE INDEX "pod_description_templates_organization_id_idx" ON "pod_description_templates"("organization_id");

-- CreateIndex
CREATE INDEX "pod_image_templates_organization_id_idx" ON "pod_image_templates"("organization_id");

-- CreateIndex
CREATE INDEX "pod_image_template_items_organization_id_idx" ON "pod_image_template_items"("organization_id");

-- CreateIndex
CREATE INDEX "pod_image_template_items_image_template_id_asset_type_sort__idx" ON "pod_image_template_items"("image_template_id", "asset_type", "sort_order");

-- CreateIndex
CREATE INDEX "pod_pricing_strategies_organization_id_idx" ON "pod_pricing_strategies"("organization_id");

-- CreateIndex
CREATE INDEX "pod_listing_templates_organization_id_market_idx" ON "pod_listing_templates"("organization_id", "market");

-- CreateIndex
CREATE INDEX "pod_listing_template_items_organization_id_idx" ON "pod_listing_template_items"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_listing_template_items_listing_template_id_item_type_re_key" ON "pod_listing_template_items"("listing_template_id", "item_type", "ref_id");

-- CreateIndex
CREATE INDEX "pod_draft_listings_organization_id_status_idx" ON "pod_draft_listings"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_draft_listings_shop_id_status_idx" ON "pod_draft_listings"("shop_id", "status");

-- CreateIndex
CREATE INDEX "pod_draft_listings_listing_template_id_idx" ON "pod_draft_listings"("listing_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_draft_listings_shop_id_product_id_listing_template_id_key" ON "pod_draft_listings"("shop_id", "product_id", "listing_template_id");

-- CreateIndex
CREATE INDEX "pod_draft_listing_items_organization_id_idx" ON "pod_draft_listing_items"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_draft_listing_items_draft_listing_id_seller_sku_key" ON "pod_draft_listing_items"("draft_listing_id", "seller_sku");

-- AddForeignKey
ALTER TABLE "pod_tiktok_warehouses" ADD CONSTRAINT "pod_tiktok_warehouses_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_category_template_attributes" ADD CONSTRAINT "pod_category_template_attributes_category_template_id_fkey" FOREIGN KEY ("category_template_id") REFERENCES "pod_category_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sku_template_variants" ADD CONSTRAINT "pod_sku_template_variants_sku_template_id_fkey" FOREIGN KEY ("sku_template_id") REFERENCES "pod_sku_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_image_template_items" ADD CONSTRAINT "pod_image_template_items_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_image_template_items" ADD CONSTRAINT "pod_image_template_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_templates" ADD CONSTRAINT "pod_listing_templates_category_template_id_fkey" FOREIGN KEY ("category_template_id") REFERENCES "pod_category_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_templates" ADD CONSTRAINT "pod_listing_templates_sku_template_id_fkey" FOREIGN KEY ("sku_template_id") REFERENCES "pod_sku_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_templates" ADD CONSTRAINT "pod_listing_templates_description_template_id_fkey" FOREIGN KEY ("description_template_id") REFERENCES "pod_description_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_templates" ADD CONSTRAINT "pod_listing_templates_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_templates" ADD CONSTRAINT "pod_listing_templates_pricing_strategy_id_fkey" FOREIGN KEY ("pricing_strategy_id") REFERENCES "pod_pricing_strategies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_templates" ADD CONSTRAINT "pod_listing_templates_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "pod_tiktok_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_template_items" ADD CONSTRAINT "pod_listing_template_items_listing_template_id_fkey" FOREIGN KEY ("listing_template_id") REFERENCES "pod_listing_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_listing_template_id_fkey" FOREIGN KEY ("listing_template_id") REFERENCES "pod_listing_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_draft_listing_items" ADD CONSTRAINT "pod_draft_listing_items_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
