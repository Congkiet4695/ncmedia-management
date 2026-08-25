-- ===========================================================================
-- LISTING SESSION — thay thế hoàn toàn mô hình "Draft Listing độc lập".
--
-- Bốn bảng cũ (`pod_draft_listings`, `_shops`, `_images`, `_variants`) bị DROP chứ không
-- RENAME: mô hình đổi chứ không phải cái tên đổi. Draft cũ tự mang market + shop + 5
-- template của riêng nó; giờ những thứ đó thuộc về SESSION, còn Draft Product chỉ còn
-- nội dung. Không có phép ánh xạ 1-1 nào từ bảng cũ sang bảng mới mà không phải bịa ra
-- session cho từng dòng. Đã kiểm trước khi viết migration này: cả bốn bảng đang RỖNG
-- (0 dòng) trên database local, và tính năng chưa phát hành.
--
-- Ba thay đổi trên bảng cũ, tất cả đều để nối vào session:
--   pod_listing_payloads.draft_listing_id  → session_product_id
--   pod_listing_job_items.draft_listing_id → session_product_id
--   pod_listing_jobs                       + session_id
-- và `listing_template_id` ở cả ba bảng chuyển sang NULL được: session chọn 5 template
-- rời, không bắt buộc có Listing Template gộp.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "pod_listing_session_status" AS ENUM ('DRAFT', 'READY', 'LISTING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "pod_listing_session_product_status" AS ENUM ('DRAFT', 'READY', 'QUEUED', 'UPLOADED', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "pod_listing_session_template_type" AS ENUM ('CATEGORY', 'SKU', 'DESCRIPTION', 'IMAGE', 'PRICING');

-- CreateEnum
CREATE TYPE "pod_listing_session_image_type" AS ENUM ('MAIN', 'VARIANT', 'DESCRIPTION', 'SIZE_CHART');

-- DropForeignKey
ALTER TABLE "pod_draft_listing_images" DROP CONSTRAINT "pod_draft_listing_images_draft_listing_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listing_images" DROP CONSTRAINT "pod_draft_listing_images_file_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listing_shops" DROP CONSTRAINT "pod_draft_listing_shops_draft_listing_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listing_shops" DROP CONSTRAINT "pod_draft_listing_shops_shop_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listing_variants" DROP CONSTRAINT "pod_draft_listing_variants_draft_listing_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_listing_template_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_platform_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_template_category_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_template_description_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_template_image_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_template_pricing_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_draft_listings" DROP CONSTRAINT "pod_draft_listings_template_sku_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_listing_job_items" DROP CONSTRAINT "pod_listing_job_items_draft_listing_id_fkey";

-- DropForeignKey
ALTER TABLE "pod_listing_payloads" DROP CONSTRAINT "pod_listing_payloads_draft_listing_id_fkey";

-- DropIndex
DROP INDEX "pod_listing_job_items_job_id_draft_listing_id_shop_id_key";

-- DropIndex
DROP INDEX "pod_listing_payloads_shop_id_draft_listing_id_listing_templ_key";

-- AlterTable
ALTER TABLE "pod_listing_job_items" DROP COLUMN "draft_listing_id",
ADD COLUMN     "session_product_id" UUID,
ALTER COLUMN "listing_template_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pod_listing_jobs" ADD COLUMN     "session_id" UUID,
ALTER COLUMN "listing_template_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pod_listing_payloads" DROP COLUMN "draft_listing_id",
ADD COLUMN     "session_product_id" UUID,
ALTER COLUMN "listing_template_id" DROP NOT NULL;

-- DropTable
DROP TABLE "pod_draft_listing_images";

-- DropTable
DROP TABLE "pod_draft_listing_shops";

-- DropTable
DROP TABLE "pod_draft_listing_variants";

-- DropTable
DROP TABLE "pod_draft_listings";

-- DropEnum
DROP TYPE "pod_draft_image_type";

-- DropEnum
DROP TYPE "pod_draft_listing_status";

-- CreateTable
CREATE TABLE "pod_listing_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "market" "pod_listing_market" NOT NULL,
    "status" "pod_listing_session_status" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(2000),
    "source_file" VARCHAR(512),
    "imported_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_listing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_session_shops" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_listing_session_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_session_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "template_type" "pod_listing_session_template_type" NOT NULL,
    "category_template_id" UUID,
    "sku_template_id" UUID,
    "description_template_id" UUID,
    "image_template_id" UUID,
    "pricing_strategy_id" UUID,
    "template_name" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_listing_session_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_session_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "title" VARCHAR(1024) NOT NULL,
    "description" TEXT,
    "handle" VARCHAR(255),
    "source_row" INTEGER,
    "status" "pod_listing_session_product_status" NOT NULL DEFAULT 'DRAFT',
    "raw_data" JSONB,
    "preview_data" JSONB,
    "issues" JSONB,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "upload_error" VARCHAR(2000),
    "uploaded_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_listing_session_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_session_product_images" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_product_id" UUID NOT NULL,
    "image_url" VARCHAR(2048) NOT NULL,
    "image_type" "pod_listing_session_image_type" NOT NULL DEFAULT 'MAIN',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "file_id" UUID,
    "remote_uri" VARCHAR(512),
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_listing_session_product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_listing_session_product_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_product_id" UUID NOT NULL,
    "variant_name" VARCHAR(512) NOT NULL,
    "sku" VARCHAR(255),
    "barcode" VARCHAR(64),
    "price" DECIMAL(18,4),
    "sale_price" DECIMAL(18,4),
    "currency" VARCHAR(10),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "variant_json" JSONB,
    "image_url" VARCHAR(2048),
    "remote_uri" VARCHAR(512),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_listing_session_product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_listing_sessions_organization_id_status_idx" ON "pod_listing_sessions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_listing_sessions_organization_id_created_at_idx" ON "pod_listing_sessions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "pod_listing_sessions_organization_id_market_idx" ON "pod_listing_sessions"("organization_id", "market");

-- CreateIndex
CREATE INDEX "pod_listing_session_shops_organization_id_idx" ON "pod_listing_session_shops"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_listing_session_shops_session_id_shop_id_key" ON "pod_listing_session_shops"("session_id", "shop_id");

-- CreateIndex
CREATE INDEX "pod_listing_session_templates_organization_id_idx" ON "pod_listing_session_templates"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_listing_session_templates_session_id_template_type_key" ON "pod_listing_session_templates"("session_id", "template_type");

-- CreateIndex
CREATE INDEX "pod_listing_session_products_organization_id_status_idx" ON "pod_listing_session_products"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_listing_session_products_session_id_sort_order_idx" ON "pod_listing_session_products"("session_id", "sort_order");

-- CreateIndex
CREATE INDEX "pod_listing_session_products_session_id_status_idx" ON "pod_listing_session_products"("session_id", "status");

-- CreateIndex
CREATE INDEX "pod_listing_session_product_images_organization_id_idx" ON "pod_listing_session_product_images"("organization_id");

-- CreateIndex
CREATE INDEX "pod_listing_session_product_images_session_product_id_sort__idx" ON "pod_listing_session_product_images"("session_product_id", "sort_order");

-- CreateIndex
CREATE INDEX "pod_listing_session_product_variants_organization_id_idx" ON "pod_listing_session_product_variants"("organization_id");

-- CreateIndex
CREATE INDEX "pod_listing_session_product_variants_session_product_id_sor_idx" ON "pod_listing_session_product_variants"("session_product_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pod_listing_job_items_job_id_session_product_id_shop_id_key" ON "pod_listing_job_items"("job_id", "session_product_id", "shop_id");

-- CreateIndex
CREATE INDEX "pod_listing_jobs_session_id_created_at_idx" ON "pod_listing_jobs"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_listing_payloads_shop_id_session_product_id_key" ON "pod_listing_payloads"("shop_id", "session_product_id");

-- AddForeignKey
ALTER TABLE "pod_listing_sessions" ADD CONSTRAINT "pod_listing_sessions_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_shops" ADD CONSTRAINT "pod_listing_session_shops_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pod_listing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_shops" ADD CONSTRAINT "pod_listing_session_shops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pod_listing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_category_template_id_fkey" FOREIGN KEY ("category_template_id") REFERENCES "pod_category_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_sku_template_id_fkey" FOREIGN KEY ("sku_template_id") REFERENCES "pod_sku_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_description_template_id_fkey" FOREIGN KEY ("description_template_id") REFERENCES "pod_description_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_pricing_strategy_id_fkey" FOREIGN KEY ("pricing_strategy_id") REFERENCES "pod_pricing_strategies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_products" ADD CONSTRAINT "pod_listing_session_products_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pod_listing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_product_images" ADD CONSTRAINT "pod_listing_session_product_images_session_product_id_fkey" FOREIGN KEY ("session_product_id") REFERENCES "pod_listing_session_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_product_images" ADD CONSTRAINT "pod_listing_session_product_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_session_product_variants" ADD CONSTRAINT "pod_listing_session_product_variants_session_product_id_fkey" FOREIGN KEY ("session_product_id") REFERENCES "pod_listing_session_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_payloads" ADD CONSTRAINT "pod_listing_payloads_session_product_id_fkey" FOREIGN KEY ("session_product_id") REFERENCES "pod_listing_session_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_jobs" ADD CONSTRAINT "pod_listing_jobs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pod_listing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_session_product_id_fkey" FOREIGN KEY ("session_product_id") REFERENCES "pod_listing_session_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- CHECK constraints — không biểu diễn được trong Prisma schema, thêm thủ công.
-- ---------------------------------------------------------------------------

-- Một Job Item phải có ĐÚNG MỘT nguồn. Không có ràng buộc này thì sớm muộn sẽ xuất hiện
-- item không nguồn (chạy mãi không ra gì) hoặc hai nguồn (không biết tin cái nào).
-- Ràng buộc cũ đã tự mất theo cột `draft_listing_id`; dựng lại theo nguồn mới.
ALTER TABLE "pod_listing_job_items" DROP CONSTRAINT IF EXISTS "pod_listing_job_items_one_source";
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_one_source"
  CHECK (("product_id" IS NOT NULL) <> ("session_product_id" IS NOT NULL));

-- Mỗi dòng template của session điền ĐÚNG cột khoá ngoại khớp với `template_type`.
-- Thiếu ràng buộc này thì tồn tại được dòng "type = SKU nhưng trỏ vào Category Template",
-- và lỗi chỉ lộ ra lúc giải template — tức là lúc đang đăng hàng.
ALTER TABLE "pod_listing_session_templates" ADD CONSTRAINT "pod_listing_session_templates_type_ref"
  CHECK (
    (
      "template_type" = 'CATEGORY'
      AND "category_template_id" IS NOT NULL
      AND "sku_template_id" IS NULL AND "description_template_id" IS NULL
      AND "image_template_id" IS NULL AND "pricing_strategy_id" IS NULL
    ) OR (
      "template_type" = 'SKU'
      AND "sku_template_id" IS NOT NULL
      AND "category_template_id" IS NULL AND "description_template_id" IS NULL
      AND "image_template_id" IS NULL AND "pricing_strategy_id" IS NULL
    ) OR (
      "template_type" = 'DESCRIPTION'
      AND "description_template_id" IS NOT NULL
      AND "category_template_id" IS NULL AND "sku_template_id" IS NULL
      AND "image_template_id" IS NULL AND "pricing_strategy_id" IS NULL
    ) OR (
      "template_type" = 'IMAGE'
      AND "image_template_id" IS NOT NULL
      AND "category_template_id" IS NULL AND "sku_template_id" IS NULL
      AND "description_template_id" IS NULL AND "pricing_strategy_id" IS NULL
    ) OR (
      "template_type" = 'PRICING'
      AND "pricing_strategy_id" IS NOT NULL
      AND "category_template_id" IS NULL AND "sku_template_id" IS NULL
      AND "description_template_id" IS NULL AND "image_template_id" IS NULL
    )
  );
