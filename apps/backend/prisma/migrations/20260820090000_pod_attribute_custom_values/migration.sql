-- Giá trị tự nhập cho thuộc tính danh mục (Custom Value).
--
-- Trước: mỗi thuộc tính chỉ giữ được MỘT chuỗi tự nhập ở cột `custom_value`.
-- Sau:   một bảng riêng, nhiều giá trị, có thứ tự hiển thị — và tách hẳn khỏi giá trị chính
--        thức của TikTok (`pod_category_template_attribute_values`) để lần đồng bộ sau không
--        đụng tới dữ liệu người dùng.
--
-- ⚠️ Thứ tự bắt buộc: tạo bảng → CHUYỂN dữ liệu cũ sang → mới được bỏ cột. Prisma sinh
-- DROP COLUMN lên đầu, làm vậy là mất trắng mọi giá trị người dùng đã nhập.

-- CreateTable
CREATE TABLE "pod_category_template_attribute_custom_values" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_attribute_id" UUID NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_category_template_attribute_custom_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_category_template_attribute_custom_values_organization__idx" ON "pod_category_template_attribute_custom_values"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "pod_category_template_attribute_custom_values_template_attr_key" ON "pod_category_template_attribute_custom_values"("template_attribute_id", "value");

-- AddForeignKey
ALTER TABLE "pod_category_template_attribute_custom_values" ADD CONSTRAINT "pod_category_template_attribute_custom_values_template_att_fkey" FOREIGN KEY ("template_attribute_id") REFERENCES "pod_category_template_attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chuyển giá trị tự nhập cũ sang bảng mới (bỏ chuỗi rỗng).
INSERT INTO "pod_category_template_attribute_custom_values"
    ("id", "organization_id", "template_attribute_id", "value", "display_order", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    "organization_id",
    "id",
    btrim("custom_value"),
    0,
    NOW(),
    NOW()
FROM "pod_category_template_attributes"
WHERE "custom_value" IS NOT NULL AND btrim("custom_value") <> '';

-- AlterTable
ALTER TABLE "pod_category_template_attributes" DROP COLUMN "custom_value";
