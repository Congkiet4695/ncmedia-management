-- ===========================================================================
-- Kho là dữ liệu CỦA SHOP, không phải của sản phẩm.
--
-- Cùng một Draft Product đăng lên ba shop là ba kho khác nhau, nên Draft không được gắn kho.
-- Kho chỉ được quyết ở bước Publish, và đây là chỗ mỗi shop khai báo lựa chọn của mình
-- (Warehouse Mapping). Để trống thì lúc Publish hệ thống tự suy: kho của Category Template
-- (nếu thuộc chính shop này) → shop chỉ có một kho → kho mặc định của shop.
-- ===========================================================================

-- AlterTable
ALTER TABLE "pod_tiktok_shops" ADD COLUMN     "default_warehouse_id" UUID;

-- AddForeignKey
ALTER TABLE "pod_tiktok_shops" ADD CONSTRAINT "pod_tiktok_shops_default_warehouse_id_fkey" FOREIGN KEY ("default_warehouse_id") REFERENCES "pod_tiktok_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

