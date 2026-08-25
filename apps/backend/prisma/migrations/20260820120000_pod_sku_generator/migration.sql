-- SKU Generator: tách "lưu trục biến thể" khỏi "sinh bảng SKU".
--
-- Trước: mỗi lần lưu template là sinh lại toàn bộ tổ hợp — sửa một chữ trong tên trục cũng
--        làm bảng SKU bị dựng lại.
-- Sau:   bảng SKU chỉ đổi khi người dùng bấm "Tạo SKU". Hai mốc thời gian bên dưới cho biết
--        trục đã đổi mà SKU chưa tạo lại ⇒ màn hình cảnh báo thay vì âm thầm ghi đè.

-- AlterTable
ALTER TABLE "pod_sku_templates" ADD COLUMN     "axes_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "items_generated_at" TIMESTAMPTZ(6);

-- Template đã có sẵn tổ hợp thì coi như vừa được tạo đúng lúc sửa lần cuối — nếu không,
-- toàn bộ template cũ sẽ hiện cảnh báo "cần tạo lại SKU" ngay sau khi nâng cấp.
UPDATE "pod_sku_templates" AS t
SET "items_generated_at" = t."updated_at",
    "axes_updated_at"    = t."updated_at"
WHERE EXISTS (
  SELECT 1 FROM "pod_sku_template_items" AS i WHERE i."sku_template_id" = t."id"
);
