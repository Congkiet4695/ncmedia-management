-- Import Product & Draft Listing Engine.
--
-- Cái tên `pod_draft_listings` đổi chủ: từ nay nó là **draft nội bộ của NCMedia** — thứ người
-- vận hành import từ Excel/CSV rồi sửa. Bảng cũ (payload hệ thống đã giải và gửi lên sàn)
-- được đổi tên thành `pod_listing_payloads` cho đúng vai trò của nó.
--
--   pod_draft_listings    → người dùng nhập / sửa   (đầu vào, sửa được)
--   pod_listing_payloads  → hệ thống giải rồi gửi   (đầu ra, chỉ đọc)
--
-- ⚠️ RENAME chứ không DROP: Prisma sinh ra migration drop-and-create cho trường hợp này, làm
-- vậy là mất toàn bộ lịch sử listing ở môi trường đã có dữ liệu.

-- =========================================================================
-- 1. Đổi tên bảng cũ + toàn bộ ràng buộc/chỉ mục đi kèm
-- =========================================================================
ALTER TABLE "pod_draft_listings" RENAME TO "pod_listing_payloads";
ALTER TABLE "pod_draft_listing_items" RENAME TO "pod_listing_payload_items";
ALTER TYPE "pod_draft_listing_status" RENAME TO "pod_listing_payload_status";

ALTER TABLE "pod_listing_payloads" RENAME CONSTRAINT "pod_draft_listings_pkey" TO "pod_listing_payloads_pkey";
ALTER TABLE "pod_listing_payloads" RENAME CONSTRAINT "pod_draft_listings_account_id_fkey" TO "pod_listing_payloads_account_id_fkey";
ALTER TABLE "pod_listing_payloads" RENAME CONSTRAINT "pod_draft_listings_listing_template_id_fkey" TO "pod_listing_payloads_listing_template_id_fkey";
ALTER TABLE "pod_listing_payloads" RENAME CONSTRAINT "pod_draft_listings_product_id_fkey" TO "pod_listing_payloads_product_id_fkey";
ALTER TABLE "pod_listing_payloads" RENAME CONSTRAINT "pod_draft_listings_shop_id_fkey" TO "pod_listing_payloads_shop_id_fkey";

ALTER INDEX "pod_draft_listings_listing_template_id_idx" RENAME TO "pod_listing_payloads_listing_template_id_idx";
ALTER INDEX "pod_draft_listings_organization_id_status_idx" RENAME TO "pod_listing_payloads_organization_id_status_idx";
ALTER INDEX "pod_draft_listings_shop_id_status_idx" RENAME TO "pod_listing_payloads_shop_id_status_idx";
ALTER INDEX "pod_draft_listings_shop_id_product_id_listing_template_id_key" RENAME TO "pod_listing_payloads_shop_id_product_id_listing_template_id_key";

ALTER TABLE "pod_listing_payload_items" RENAME COLUMN "draft_listing_id" TO "payload_id";
ALTER TABLE "pod_listing_payload_items" RENAME CONSTRAINT "pod_draft_listing_items_pkey" TO "pod_listing_payload_items_pkey";
ALTER TABLE "pod_listing_payload_items" RENAME CONSTRAINT "pod_draft_listing_items_draft_listing_id_fkey" TO "pod_listing_payload_items_payload_id_fkey";
ALTER INDEX "pod_draft_listing_items_organization_id_idx" RENAME TO "pod_listing_payload_items_organization_id_idx";
ALTER INDEX "pod_draft_listing_items_draft_listing_id_seller_sku_key" RENAME TO "pod_listing_payload_items_payload_id_seller_sku_key";

-- =========================================================================
-- 2. Enum mới cho draft nội bộ
-- =========================================================================
CREATE TYPE "pod_draft_listing_status" AS ENUM ('DRAFT', 'READY', 'QUEUED', 'UPLOADED_TO_TIKTOK', 'FAILED', 'ARCHIVED');
CREATE TYPE "pod_draft_image_type" AS ENUM ('MAIN', 'VARIANT', 'DESCRIPTION', 'SIZE_CHART');

-- =========================================================================
-- 3. Bảng Draft Listing nội bộ
-- =========================================================================
CREATE TABLE "pod_draft_listings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "title" VARCHAR(1024) NOT NULL,
    "description" TEXT,
    "source_file" VARCHAR(512),
    "market" "pod_listing_market" NOT NULL,
    "status" "pod_draft_listing_status" NOT NULL DEFAULT 'DRAFT',
    "template_category_id" UUID,
    "template_sku_id" UUID,
    "template_description_id" UUID,
    "template_image_id" UUID,
    "template_pricing_id" UUID,
    "listing_template_id" UUID,
    "raw_data" JSONB,
    "preview_data" JSONB,
    "issues" JSONB,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "tiktok_product_id" VARCHAR(64),
    "tiktok_draft_id" VARCHAR(64),
    "uploaded_at" TIMESTAMPTZ(6),
    "upload_error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_draft_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pod_draft_listing_shops" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "draft_listing_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_draft_listing_shops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pod_draft_listing_images" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "draft_listing_id" UUID NOT NULL,
    "image_url" VARCHAR(2048) NOT NULL,
    "image_type" "pod_draft_image_type" NOT NULL DEFAULT 'MAIN',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "file_id" UUID,
    "remote_uri" VARCHAR(512),
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_draft_listing_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pod_draft_listing_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "draft_listing_id" UUID NOT NULL,
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

    CONSTRAINT "pod_draft_listing_variants_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX "pod_draft_listings_organization_id_status_idx" ON "pod_draft_listings"("organization_id", "status");
CREATE INDEX "pod_draft_listings_organization_id_created_at_idx" ON "pod_draft_listings"("organization_id", "created_at");
CREATE INDEX "pod_draft_listings_organization_id_market_idx" ON "pod_draft_listings"("organization_id", "market");
CREATE INDEX "pod_draft_listing_shops_organization_id_idx" ON "pod_draft_listing_shops"("organization_id");
CREATE UNIQUE INDEX "pod_draft_listing_shops_draft_listing_id_shop_id_key" ON "pod_draft_listing_shops"("draft_listing_id", "shop_id");
CREATE INDEX "pod_draft_listing_images_organization_id_idx" ON "pod_draft_listing_images"("organization_id");
CREATE INDEX "pod_draft_listing_images_draft_listing_id_sort_order_idx" ON "pod_draft_listing_images"("draft_listing_id", "sort_order");
CREATE INDEX "pod_draft_listing_variants_organization_id_idx" ON "pod_draft_listing_variants"("organization_id");
CREATE INDEX "pod_draft_listing_variants_draft_listing_id_sort_order_idx" ON "pod_draft_listing_variants"("draft_listing_id", "sort_order");

-- Foreign key
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_template_category_id_fkey" FOREIGN KEY ("template_category_id") REFERENCES "pod_category_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_template_sku_id_fkey" FOREIGN KEY ("template_sku_id") REFERENCES "pod_sku_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_template_description_id_fkey" FOREIGN KEY ("template_description_id") REFERENCES "pod_description_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_template_image_id_fkey" FOREIGN KEY ("template_image_id") REFERENCES "pod_image_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_template_pricing_id_fkey" FOREIGN KEY ("template_pricing_id") REFERENCES "pod_pricing_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listings" ADD CONSTRAINT "pod_draft_listings_listing_template_id_fkey" FOREIGN KEY ("listing_template_id") REFERENCES "pod_listing_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pod_draft_listing_shops" ADD CONSTRAINT "pod_draft_listing_shops_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listing_shops" ADD CONSTRAINT "pod_draft_listing_shops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listing_images" ADD CONSTRAINT "pod_draft_listing_images_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listing_images" ADD CONSTRAINT "pod_draft_listing_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pod_draft_listing_variants" ADD CONSTRAINT "pod_draft_listing_variants_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 4. Payload nhận thêm nguồn "draft nội bộ"
-- =========================================================================
ALTER TABLE "pod_listing_payloads" ADD COLUMN "draft_listing_id" UUID;
ALTER TABLE "pod_listing_payloads" ADD CONSTRAINT "pod_listing_payloads_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pod_listing_payloads_shop_id_draft_listing_id_listing_templa_key" ON "pod_listing_payloads"("shop_id", "draft_listing_id", "listing_template_id");

-- =========================================================================
-- 5. Job Item: nguồn có thể là sản phẩm ĐÃ ĐỒNG BỘ hoặc DRAFT nội bộ
-- =========================================================================
ALTER TABLE "pod_listing_job_items" DROP CONSTRAINT "pod_listing_job_items_draft_listing_id_fkey";
ALTER TABLE "pod_listing_job_items" RENAME COLUMN "draft_listing_id" TO "payload_id";
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_payload_id_fkey" FOREIGN KEY ("payload_id") REFERENCES "pod_listing_payloads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pod_listing_job_items" ADD COLUMN "draft_listing_id" UUID;
ALTER TABLE "pod_listing_job_items" ALTER COLUMN "product_id" DROP NOT NULL;
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_draft_listing_id_fkey" FOREIGN KEY ("draft_listing_id") REFERENCES "pod_draft_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pod_listing_job_items_job_id_draft_listing_id_shop_id_key" ON "pod_listing_job_items"("job_id", "draft_listing_id", "shop_id");

-- Một item phải có ĐÚNG MỘT nguồn. Không có ràng buộc này thì một ngày nào đó sẽ xuất hiện
-- item không nguồn (chạy mãi không ra gì) hoặc hai nguồn (không biết tin cái nào).
ALTER TABLE "pod_listing_job_items" ADD CONSTRAINT "pod_listing_job_items_one_source"
  CHECK (("product_id" IS NOT NULL) <> ("draft_listing_id" IS NOT NULL));
