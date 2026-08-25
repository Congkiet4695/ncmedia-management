-- Image Template = BỘ ẢNH MẪU (mockup) của phôi, không còn là quy tắc trỏ vào ảnh sản phẩm.
--
-- pod_image_template_slots (ô ảnh + nguồn) được thay bằng pod_image_template_items:
-- mỗi dòng là MỘT TẤM ẢNH thật trên R2, kèm title / loại / kích thước / thứ tự.
-- Enum loại ảnh đổi sang bộ 7 giá trị của POD (MAIN_FRONT … CUSTOM).
--
-- Bảng cũ đang RỖNG (đã kiểm bằng COUNT) nên không mất dữ liệu nghiệp vụ nào.
--
-- 🔴 THỨ TỰ QUAN TRỌNG: phải bỏ bảng cũ TRƯỚC rồi mới thay enum. Bản SQL do
-- `prisma migrate diff` sinh ra đặt lệnh đổi enum lên đầu và trỏ vào bảng chưa tồn tại
-- (`pod_image_template_items`), nên chạy là hỏng ngay ở bước đầu.

-- 1. Bỏ bảng ô ảnh cũ (kéo theo hai khoá ngoại của nó).
DROP TABLE "pod_image_template_slots";

-- 2. Bỏ enum nguồn ảnh — thiết kế mới không lấy ảnh từ sản phẩm nữa.
DROP TYPE "pod_image_slot_source";

-- 3. Thay enum loại ảnh. Lúc này không còn bảng nào tham chiếu nên bỏ và tạo lại là đủ.
DROP TYPE "pod_image_asset_type";
CREATE TYPE "pod_image_asset_type" AS ENUM ('MAIN_FRONT', 'MAIN_BACK', 'LIFESTYLE', 'DETAIL', 'SIZE_CHART', 'PACKAGING', 'CUSTOM');

-- 4. Template: `note` một dòng → `description` nhiều dòng.
ALTER TABLE "pod_image_templates" DROP COLUMN "note",
ADD COLUMN     "description" TEXT;

-- 5. Bảng ảnh mới.
CREATE TABLE "pod_image_template_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "image_template_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "asset_type" "pod_image_asset_type" NOT NULL,
    "file_id" UUID NOT NULL,
    "image_url" VARCHAR(2048) NOT NULL,
    "image_key" VARCHAR(1024) NOT NULL,
    "content_type" VARCHAR(150) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "tiktok_image_uri" VARCHAR(512),
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pod_image_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_image_template_items_organization_id_idx" ON "pod_image_template_items"("organization_id");

-- CreateIndex
CREATE INDEX "pod_image_template_items_image_template_id_display_order_idx" ON "pod_image_template_items"("image_template_id", "display_order");

-- AddForeignKey
ALTER TABLE "pod_image_template_items" ADD CONSTRAINT "pod_image_template_items_image_template_id_fkey" FOREIGN KEY ("image_template_id") REFERENCES "pod_image_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_image_template_items" ADD CONSTRAINT "pod_image_template_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
