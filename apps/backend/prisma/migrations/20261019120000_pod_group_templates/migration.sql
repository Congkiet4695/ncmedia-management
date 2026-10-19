-- Group Template: bộ 4 mảnh (Category · SKU · Description · Image) áp vào Auto Listing / Custom Listing.
-- Chỉ THÊM bảng/cột mới (nullable) — không đụng dữ liệu hiện có, không backfill.

-- AlterTable
ALTER TABLE "pod_listing_sessions" ADD COLUMN     "group_template_id" UUID,
ADD COLUMN     "group_template_name" VARCHAR(255);

-- CreateTable
CREATE TABLE "pod_group_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category_template_id" UUID,
    "sku_template_id" UUID,
    "description_template_id" UUID,
    "image_template_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "pod_group_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_group_templates_organization_id_display_order_idx" ON "pod_group_templates"("organization_id", "display_order");

-- CreateIndex
CREATE INDEX "pod_group_templates_category_template_id_idx" ON "pod_group_templates"("category_template_id");

-- CreateIndex
CREATE INDEX "pod_group_templates_sku_template_id_idx" ON "pod_group_templates"("sku_template_id");

-- CreateIndex
CREATE INDEX "pod_group_templates_description_template_id_idx" ON "pod_group_templates"("description_template_id");

-- CreateIndex
CREATE INDEX "pod_group_templates_image_template_id_idx" ON "pod_group_templates"("image_template_id");

-- CreateIndex
CREATE INDEX "pod_listing_sessions_group_template_id_idx" ON "pod_listing_sessions"("group_template_id");

-- AddForeignKey
ALTER TABLE "pod_group_templates" ADD CONSTRAINT "pod_group_templates_category_template_id_fkey" FOREIGN KEY ("category_template_id") REFERENCES "pod_category_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_group_templates" ADD CONSTRAINT "pod_group_templates_sku_template_id_fkey" FOREIGN KEY ("sku_template_id") REFERENCES "pod_sku_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_group_templates" ADD CONSTRAINT "pod_group_templates_description_template_id_fkey" FOREIGN KEY ("description_template_id") REFERENCES "pod_description_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_group_templates" ADD CONSTRAINT "pod_group_templates_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_listing_sessions" ADD CONSTRAINT "pod_listing_sessions_group_template_id_fkey" FOREIGN KEY ("group_template_id") REFERENCES "pod_group_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tên group duy nhất trong Organization, không phân biệt hoa thường; bản đã xoá mềm không
-- giữ chỗ tên (xoá rồi tạo lại cùng tên là chuyện bình thường).
CREATE UNIQUE INDEX "pod_group_templates_org_name_key"
    ON "pod_group_templates"("organization_id", lower("name"))
    WHERE "deleted_at" IS NULL;

-- Một group rỗng (không mảnh nào) không áp được gì — chặn ở tầng dữ liệu, service báo lỗi rõ ràng trước.
ALTER TABLE "pod_group_templates" ADD CONSTRAINT "pod_group_templates_has_part_check"
    CHECK (num_nonnulls("category_template_id", "sku_template_id", "description_template_id", "image_template_id") > 0);
