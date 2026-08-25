-- TEMPLATE ENGINE — Template là QUY TẮC, không phụ thuộc sản phẩm cụ thể.
--
-- 1. pod_image_template_slots thay pod_image_template_items: ô ảnh mô tả VAI TRÒ +
--    NGUỒN (design / ảnh sản phẩm / ảnh biến thể / video / file cố định) thay vì trỏ
--    cứng vào một tấm ảnh. Nhờ vậy một Image Template dùng cho hàng nghìn sản phẩm.
-- 2. pod_listing_template_scopes: quy tắc chọn tập sản phẩm mà template áp dụng
--    (Template → Product, KHÔNG phải Product → Template).
-- 3. pod_sku_template_items thêm điều chỉnh giá theo biến thể để hợp với Pricing
--    Template thay vì ghi đè giá.
-- 4. pod_listing_templates thêm kiện hàng ghi đè Category Template.
--
-- Bảng pod_image_template_items đang RỖNG (đã kiểm bằng COUNT) nên DROP TABLE không
-- làm mất dữ liệu nghiệp vụ nào.

-- CreateEnum
CREATE TYPE "pod_image_slot_source" AS ENUM ('STATIC', 'PRODUCT_IMAGE', 'VARIANT_IMAGE', 'PRODUCT_VIDEO', 'DESIGN');

-- CreateEnum
CREATE TYPE "pod_price_adjustment_type" AS ENUM ('NONE', 'AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "pod_listing_scope_match" AS ENUM ('ALL', 'CATEGORY', 'BRAND', 'SHOP', 'TITLE_KEYWORD', 'SELLER_SKU_PREFIX', 'PRODUCT_STATUS');

-- DropForeignKey
ALTER TABLE "pod_image_template_items" DROP CONSTRAINT "pod_image_template_items_file_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_image_template_items" DROP CONSTRAINT "pod_image_template_items_image_template_id_fkey";

-- AlterTable
ALTER TABLE "pod_listing_templates" ADD COLUMN     "dimension_unit" VARCHAR(16),
ADD COLUMN     "package_height" VARCHAR(32),
ADD COLUMN     "package_length" VARCHAR(32),
ADD COLUMN     "package_weight" VARCHAR(32),
ADD COLUMN     "package_width" VARCHAR(32),
ADD COLUMN     "weight_unit" VARCHAR(16);

-- AlterTable
ALTER TABLE "pod_sku_template_items" ADD COLUMN     "price_adjustment_type" "pod_price_adjustment_type" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "price_adjustment_value" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "pod_image_template_items";

-- CreateTable
CREATE TABLE "pod_image_template_slots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "image_template_id" UUID NOT NULL,
    "asset_type" "pod_image_asset_type" NOT NULL,
    "source" "pod_image_slot_source" NOT NULL DEFAULT 'STATIC',
    "label" VARCHAR(120),
    "source_index" INTEGER NOT NULL DEFAULT 0,
    "file_id" UUID,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tiktok_image_uri" VARCHAR(512),
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_image_template_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_template_scopes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "listing_template_id" UUID NOT NULL,
    "match_type" "pod_listing_scope_match" NOT NULL,
    "value" VARCHAR(255),
    "value_label" VARCHAR(255),
    "is_exclude" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_listing_template_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_image_template_slots_organization_id_idx" ON "pod_image_template_slots"("organization_id");

-- CreateIndex
CREATE INDEX "pod_image_template_slots_image_template_id_sort_order_idx" ON "pod_image_template_slots"("image_template_id", "sort_order");

-- CreateIndex
CREATE INDEX "pod_listing_template_scopes_organization_id_idx" ON "pod_listing_template_scopes"("organization_id");

-- CreateIndex
CREATE INDEX "pod_listing_template_scopes_listing_template_id_idx" ON "pod_listing_template_scopes"("listing_template_id");

-- AddForeignKey
ALTER TABLE "pod_image_template_slots" ADD CONSTRAINT "pod_image_template_slots_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_image_template_slots" ADD CONSTRAINT "pod_image_template_slots_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_template_scopes" ADD CONSTRAINT "pod_listing_template_scopes_listing_template_id_fkey" FOREIGN KEY ("listing_template_id") REFERENCES "pod_listing_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

