-- Sprint Flash Sale — Promotion Activity (activity_type = FLASHSALE) cua TikTok Shop.
--
-- Bon bang: pod_flash_sales (dot sale) · pod_flash_sale_items (dong san pham/bien the)
-- · pod_flash_sale_templates (cau hinh dung lai, KHONG mang thoi gian) · pod_flash_sale_logs
-- (vet request/response de Retry va mo ticket voi TikTok).

-- CreateEnum
CREATE TYPE "pod_flash_sale_status" AS ENUM ('DRAFT', 'READY', 'PUBLISHING', 'RUNNING', 'ENDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "pod_flash_sale_item_status" AS ENUM ('PENDING', 'READY', 'PUBLISHED', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "pod_flash_sale_product_level" AS ENUM ('PRODUCT', 'VARIATION');

-- CreateEnum
CREATE TYPE "pod_flash_sale_log_action" AS ENUM ('CREATE_ACTIVITY', 'UPDATE_ACTIVITY', 'UPDATE_PRODUCTS', 'REMOVE_PRODUCTS', 'DEACTIVATE', 'SYNC_STATUS', 'VALIDATE');

-- CreateEnum
CREATE TYPE "pod_flash_sale_log_level" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "pod_flash_sales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'TIKTOK',
    "provider_flash_sale_id" VARCHAR(64),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "pod_flash_sale_status" NOT NULL DEFAULT 'DRAFT',
    "product_level" "pod_flash_sale_product_level" NOT NULL DEFAULT 'VARIATION',
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "provider_status" VARCHAR(40),
    "published_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(32),
    "last_error_message" VARCHAR(2000),
    "last_error_request_id" VARCHAR(64),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "source_template_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_flash_sale_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "flash_sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "sku_id" VARCHAR(255),
    "original_price" DECIMAL(18,4) NOT NULL,
    "flash_sale_price" DECIMAL(18,4) NOT NULL,
    "discount_percent" DECIMAL(7,4) NOT NULL,
    "currency" VARCHAR(10),
    "total_purchase_limit" INTEGER NOT NULL DEFAULT -1,
    "customer_purchase_limit" INTEGER NOT NULL DEFAULT -1,
    "provider_product_id" VARCHAR(64),
    "provider_variant_id" VARCHAR(64),
    "provider_sku_id" VARCHAR(64),
    "status" "pod_flash_sale_item_status" NOT NULL DEFAULT 'PENDING',
    "error_code" VARCHAR(32),
    "error" VARCHAR(2000),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_flash_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_flash_sale_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_flash_sale_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_flash_sale_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "flash_sale_id" UUID NOT NULL,
    "action" "pod_flash_sale_log_action" NOT NULL,
    "level" "pod_flash_sale_log_level" NOT NULL DEFAULT 'INFO',
    "message" VARCHAR(2000) NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "error_code" VARCHAR(32),
    "error_message" VARCHAR(2000),
    "request_id" VARCHAR(64),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "pod_flash_sale_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_flash_sales_organization_id_status_idx" ON "pod_flash_sales"("organization_id", "status");

-- CreateIndex
CREATE INDEX "pod_flash_sales_organization_id_start_at_idx" ON "pod_flash_sales"("organization_id", "start_at");

-- CreateIndex
CREATE INDEX "pod_flash_sales_shop_id_status_idx" ON "pod_flash_sales"("shop_id", "status");

-- CreateIndex
CREATE INDEX "pod_flash_sales_account_id_idx" ON "pod_flash_sales"("account_id");

-- CreateIndex
CREATE INDEX "pod_flash_sales_status_end_at_idx" ON "pod_flash_sales"("status", "end_at");

-- CreateIndex
CREATE UNIQUE INDEX "pod_flash_sales_shop_id_provider_flash_sale_id_key" ON "pod_flash_sales"("shop_id", "provider_flash_sale_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_items_organization_id_idx" ON "pod_flash_sale_items"("organization_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_items_flash_sale_id_sort_order_idx" ON "pod_flash_sale_items"("flash_sale_id", "sort_order");

-- CreateIndex
CREATE INDEX "pod_flash_sale_items_product_id_idx" ON "pod_flash_sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_flash_sale_items_flash_sale_id_variant_id_key" ON "pod_flash_sale_items"("flash_sale_id", "variant_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_templates_organization_id_idx" ON "pod_flash_sale_templates"("organization_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_templates_account_id_idx" ON "pod_flash_sale_templates"("account_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_templates_shop_id_idx" ON "pod_flash_sale_templates"("shop_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_logs_organization_id_idx" ON "pod_flash_sale_logs"("organization_id");

-- CreateIndex
CREATE INDEX "pod_flash_sale_logs_flash_sale_id_created_at_idx" ON "pod_flash_sale_logs"("flash_sale_id", "created_at");

-- AddForeignKey
ALTER TABLE "pod_flash_sales" ADD CONSTRAINT "pod_flash_sales_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sales" ADD CONSTRAINT "pod_flash_sales_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sales" ADD CONSTRAINT "pod_flash_sales_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "pod_flash_sale_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sales" ADD CONSTRAINT "pod_flash_sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sale_items" ADD CONSTRAINT "pod_flash_sale_items_flash_sale_id_fkey" FOREIGN KEY ("flash_sale_id") REFERENCES "pod_flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sale_items" ADD CONSTRAINT "pod_flash_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pod_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sale_items" ADD CONSTRAINT "pod_flash_sale_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "pod_product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sale_templates" ADD CONSTRAINT "pod_flash_sale_templates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pod_tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sale_templates" ADD CONSTRAINT "pod_flash_sale_templates_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_flash_sale_logs" ADD CONSTRAINT "pod_flash_sale_logs_flash_sale_id_fkey" FOREIGN KEY ("flash_sale_id") REFERENCES "pod_flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rang buoc NGOAI Prisma (Prisma chua khai bao duoc partial index / CHECK).
-- ---------------------------------------------------------------------------

-- Chong trung o MUC PRODUCT. UNIQUE(flash_sale_id, variant_id) cua Prisma khong chan duoc
-- vi trong PostgreSQL NULL khong bang chinh no ⇒ cung mot san pham them 10 lan van lot.
CREATE UNIQUE INDEX "pod_flash_sale_items_product_level_key"
  ON "pod_flash_sale_items" ("flash_sale_id", "product_id")
  WHERE "variant_id" IS NULL;

-- Ten dot sale duy nhat TRONG MOT SHOP (TikTok yeu cau `title` duy nhat trong shop).
-- Partial index: ban ghi da soft delete khong con giu cho ten.
CREATE UNIQUE INDEX "pod_flash_sales_shop_name_key"
  ON "pod_flash_sales" ("shop_id", "name")
  WHERE "deleted_at" IS NULL;

-- Ten template duy nhat trong to chuc, cung luat soft delete nhu tren.
CREATE UNIQUE INDEX "pod_flash_sale_templates_org_name_key"
  ON "pod_flash_sale_templates" ("organization_id", "name")
  WHERE "deleted_at" IS NULL;

-- Khoang thoi gian phai hop le. Chan tai tang DB vi day la bat bien cua nghiep vu:
-- moi duong ghi (API, scheduler, duplicate, apply template) deu phai tuan thu.
ALTER TABLE "pod_flash_sales"
  ADD CONSTRAINT "pod_flash_sales_time_range_check" CHECK ("end_at" > "start_at");

-- Gia deal phai duong va khong duoc vuot gia goc; % giam nam trong [0, 100).
ALTER TABLE "pod_flash_sale_items"
  ADD CONSTRAINT "pod_flash_sale_items_price_check"
  CHECK ("flash_sale_price" > 0 AND "original_price" > 0 AND "flash_sale_price" <= "original_price");

ALTER TABLE "pod_flash_sale_items"
  ADD CONSTRAINT "pod_flash_sale_items_discount_check"
  CHECK ("discount_percent" >= 0 AND "discount_percent" < 100);

-- Gioi han mua: [1, 99] hoac -1 (khong gioi han) — dung dai TikTok cho phep.
ALTER TABLE "pod_flash_sale_items"
  ADD CONSTRAINT "pod_flash_sale_items_limit_check"
  CHECK (
    ("total_purchase_limit" = -1 OR ("total_purchase_limit" BETWEEN 1 AND 99))
    AND ("customer_purchase_limit" = -1 OR ("customer_purchase_limit" BETWEEN 1 AND 99))
  );
