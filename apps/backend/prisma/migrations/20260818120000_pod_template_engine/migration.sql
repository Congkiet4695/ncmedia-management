-- Sprint 3 — TEMPLATE ENGINE.
--
-- Chuẩn hoá SKU Template thành 4 bảng (template / trục / giá trị trục / tổ hợp + nối),
-- tách giá trị thuộc tính của Category Template ra bảng riêng, thêm bảng token cho
-- Description Template, thêm kiểu giá FORMULA và bổ sung các marketplace của TikTok Shop.
--
-- Mọi bảng template đều đang RỖNG tại thời điểm chạy (đã kiểm tra bằng COUNT), nên các
-- thao tác DROP COLUMN dưới đây không làm mất dữ liệu nghiệp vụ nào.

-- AlterEnum
ALTER TYPE "pod_image_asset_type" ADD VALUE 'DETAIL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "pod_listing_market" ADD VALUE 'DE';
ALTER TYPE "pod_listing_market" ADD VALUE 'FR';
ALTER TYPE "pod_listing_market" ADD VALUE 'IT';
ALTER TYPE "pod_listing_market" ADD VALUE 'ES';
ALTER TYPE "pod_listing_market" ADD VALUE 'IE';
ALTER TYPE "pod_listing_market" ADD VALUE 'JP';
ALTER TYPE "pod_listing_market" ADD VALUE 'SG';
ALTER TYPE "pod_listing_market" ADD VALUE 'MY';
ALTER TYPE "pod_listing_market" ADD VALUE 'TH';
ALTER TYPE "pod_listing_market" ADD VALUE 'VN';
ALTER TYPE "pod_listing_market" ADD VALUE 'PH';
ALTER TYPE "pod_listing_market" ADD VALUE 'ID';
ALTER TYPE "pod_listing_market" ADD VALUE 'BR';
ALTER TYPE "pod_listing_market" ADD VALUE 'MX';

-- AlterEnum
ALTER TYPE "pod_pricing_markup_type" ADD VALUE 'FORMULA';

-- DropIndex
DROP INDEX "pod_sku_template_variants_sku_template_id_variant_name_key";

-- AlterTable
ALTER TABLE "pod_category_template_attributes" DROP COLUMN "values",
ADD COLUMN     "attribute_type" VARCHAR(40),
ADD COLUMN     "is_customizable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_multiple_selection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pod_category_templates" ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "pod_description_templates" ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "note" VARCHAR(500);

-- AlterTable
ALTER TABLE "pod_image_templates" ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "note" VARCHAR(500);

-- AlterTable
ALTER TABLE "pod_listing_templates" ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pod_pricing_strategies" DROP COLUMN "list_price_multiplier",
ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "formula" VARCHAR(500),
ADD COLUMN     "note" VARCHAR(500),
ADD COLUMN     "retail_price_multiplier" DECIMAL(9,4) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "pod_sku_template_variants" DROP COLUMN "discount",
DROP COLUMN "image_file_id",
DROP COLUMN "is_active",
DROP COLUMN "list_price",
DROP COLUMN "optionValues",
DROP COLUMN "quantity",
DROP COLUMN "retail_price",
DROP COLUMN "sku_code",
DROP COLUMN "variant_name",
ADD COLUMN     "name" VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE "pod_sku_templates" DROP COLUMN "default_list_price",
DROP COLUMN "options",
ADD COLUMN     "default_sale_price" DECIMAL(18,4),
ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "note" VARCHAR(500);

-- CreateTable
CREATE TABLE "pod_category_template_attribute_values" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_attribute_id" UUID NOT NULL,
    "tiktok_value_id" VARCHAR(64) NOT NULL,
    "value_name" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_category_template_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_sku_template_variant_values" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "value" VARCHAR(128) NOT NULL,
    "code" VARCHAR(32),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_sku_template_variant_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_sku_template_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku_template_id" UUID NOT NULL,
    "variant_name" VARCHAR(512) NOT NULL,
    "sku_code" VARCHAR(128),
    "barcode" VARCHAR(64),
    "retail_price" DECIMAL(18,4),
    "sale_price" DECIMAL(18,4),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "discount" DECIMAL(9,4),
    "image_file_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_sku_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_sku_template_item_values" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "variant_value_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_sku_template_item_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_description_template_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "description_template_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(255),
    "value" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_description_template_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_category_template_attribute_values_organization_id_idx" ON "pod_category_template_attribute_values"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_category_template_attribute_values_template_attribute_i_key" ON "pod_category_template_attribute_values"("template_attribute_id", "tiktok_value_id");

-- CreateIndex
CREATE INDEX "pod_sku_template_variant_values_organization_id_idx" ON "pod_sku_template_variant_values"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_sku_template_variant_values_variant_id_value_key" ON "pod_sku_template_variant_values"("variant_id", "value");

-- CreateIndex
CREATE INDEX "pod_sku_template_items_organization_id_idx" ON "pod_sku_template_items"("organization_id");

-- CreateIndex
CREATE INDEX "pod_sku_template_items_sku_template_id_sort_order_idx" ON "pod_sku_template_items"("sku_template_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pod_sku_template_items_sku_template_id_variant_name_key" ON "pod_sku_template_items"("sku_template_id", "variant_name");

-- CreateIndex
CREATE INDEX "pod_sku_template_item_values_organization_id_idx" ON "pod_sku_template_item_values"("organization_id");

-- CreateIndex
CREATE INDEX "pod_sku_template_item_values_variant_value_id_idx" ON "pod_sku_template_item_values"("variant_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_sku_template_item_values_item_id_variant_value_id_key" ON "pod_sku_template_item_values"("item_id", "variant_value_id");

-- CreateIndex
CREATE INDEX "pod_description_template_tokens_organization_id_idx" ON "pod_description_template_tokens"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_description_template_tokens_description_template_id_cod_key" ON "pod_description_template_tokens"("description_template_id", "code");

-- CreateIndex
CREATE INDEX "pod_category_templates_organization_id_display_order_idx" ON "pod_category_templates"("organization_id", "display_order");

-- CreateIndex
CREATE INDEX "pod_description_templates_organization_id_display_order_idx" ON "pod_description_templates"("organization_id", "display_order");

-- CreateIndex
CREATE INDEX "pod_image_templates_organization_id_display_order_idx" ON "pod_image_templates"("organization_id", "display_order");

-- CreateIndex
CREATE INDEX "pod_listing_templates_organization_id_display_order_idx" ON "pod_listing_templates"("organization_id", "display_order");

-- CreateIndex
CREATE INDEX "pod_pricing_strategies_organization_id_display_order_idx" ON "pod_pricing_strategies"("organization_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "pod_sku_template_variants_sku_template_id_name_key" ON "pod_sku_template_variants"("sku_template_id", "name");

-- CreateIndex
CREATE INDEX "pod_sku_templates_organization_id_display_order_idx" ON "pod_sku_templates"("organization_id", "display_order");

-- AddForeignKey
ALTER TABLE "pod_category_templates" ADD CONSTRAINT "pod_category_templates_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "pod_tiktok_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_category_template_attribute_values" ADD CONSTRAINT "pod_category_template_attribute_values_template_attribute__fkey" FOREIGN KEY ("template_attribute_id") REFERENCES "pod_category_template_attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sku_template_variant_values" ADD CONSTRAINT "pod_sku_template_variant_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "pod_sku_template_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sku_template_items" ADD CONSTRAINT "pod_sku_template_items_sku_template_id_fkey" FOREIGN KEY ("sku_template_id") REFERENCES "pod_sku_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sku_template_items" ADD CONSTRAINT "pod_sku_template_items_image_file_id_fkey" FOREIGN KEY ("image_file_id") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sku_template_item_values" ADD CONSTRAINT "pod_sku_template_item_values_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "pod_sku_template_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_sku_template_item_values" ADD CONSTRAINT "pod_sku_template_item_values_variant_value_id_fkey" FOREIGN KEY ("variant_value_id") REFERENCES "pod_sku_template_variant_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_description_template_tokens" ADD CONSTRAINT "pod_description_template_tokens_description_template_id_fkey" FOREIGN KEY ("description_template_id") REFERENCES "pod_description_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

