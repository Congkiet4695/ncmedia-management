-- Design chuyển từ ĐƠN HÀNG sang PRODUCT MAPPING
--
-- LÝ DO (bắt buộc giải thích theo yêu cầu):
--   Trước đây design gắn theo từng line item (`pod_order_item_designs`). Dữ liệu thật cho
--   thấy 53 SKU thì 32 SKU lặp lại, cao nhất 11 lần — nghĩa là người vận hành phải upload
--   CÙNG MỘT file in tới 11 lần cho một sản phẩm, và chỉ cần sót một lần là đơn đó ra xưởng
--   thiếu file. Design là thuộc tính của SẢN PHẨM, không phải của từng lần bán.
--
-- KHÔNG MẤT DỮ LIỆU:
--   Bảng `pod_order_item_designs` được GIỮ NGUYÊN, không drop, không xoá dòng nào. Migration
--   chỉ CHÉP các design đang sống sang bảng mới khi tìm được Product Mapping tương ứng.
--   Design không khớp mapping nào vẫn nằm nguyên ở bảng cũ để tra lại.

-- 1. Loại tham chiếu file mới ---------------------------------------------------------------
ALTER TYPE "storage_reference_type" ADD VALUE IF NOT EXISTS 'FULFILLMENT_MAPPING_DESIGN';

-- 2. Bảng design theo Mapping ---------------------------------------------------------------
CREATE TABLE "fulfillment_mapping_designs" (
  "id"              UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "mapping_id"      UUID NOT NULL,
  "placement"       "pod_design_placement" NOT NULL,
  "storage_file_id" UUID NOT NULL,
  "version"         INTEGER NOT NULL DEFAULT 1,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"      TIMESTAMPTZ(6),
  "created_by"      UUID,
  "updated_by"      UUID,

  CONSTRAINT "fulfillment_mapping_designs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fulfillment_mapping_designs_organization_id_idx"
  ON "fulfillment_mapping_designs" ("organization_id");
CREATE INDEX "fulfillment_mapping_designs_mapping_id_placement_idx"
  ON "fulfillment_mapping_designs" ("mapping_id", "placement");

-- 🔴 UNIQUE TỪNG PHẦN: mỗi Mapping chỉ có MỘT design ĐANG SỐNG cho mỗi vị trí in.
-- Dùng partial index (không phải @@unique thường) để bản đã xoá mềm vẫn nằm lại làm lịch sử
-- mà không chặn lần upload sau — đúng luồng Delete rồi Upload lại của yêu cầu §2.
CREATE UNIQUE INDEX "fulfillment_mapping_designs_active_unique"
  ON "fulfillment_mapping_designs" ("mapping_id", "placement")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "fulfillment_mapping_designs"
  ADD CONSTRAINT "fulfillment_mapping_designs_mapping_id_fkey"
  FOREIGN KEY ("mapping_id") REFERENCES "fulfillment_product_mappings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fulfillment_mapping_designs"
  ADD CONSTRAINT "fulfillment_mapping_designs_storage_file_id_fkey"
  FOREIGN KEY ("storage_file_id") REFERENCES "storage_files"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Chuyển design đang sống sang Mapping ----------------------------------------------------
-- Ghép line item → mapping theo ĐÚNG thứ tự ưu tiên của FulfillmentReadinessService:
--   SKU biến thể (tiktok_sku_id) → Seller SKU → Product ID.
-- `DISTINCT ON` giữ đúng MỘT design cho mỗi (mapping, placement) — bản mới nhất thắng, nên
-- chạy migration không thể vi phạm unique index ở trên.
INSERT INTO "fulfillment_mapping_designs"
  ("id", "organization_id", "mapping_id", "placement", "storage_file_id", "version",
   "created_at", "updated_at", "created_by")
SELECT DISTINCT ON (m."id", d."placement")
  gen_random_uuid(), d."organization_id", m."id", d."placement", d."storage_file_id",
  d."version", d."created_at", CURRENT_TIMESTAMP, d."created_by"
FROM "pod_order_item_designs" d
JOIN "pod_order_items" i ON i."id" = d."order_item_id"
JOIN "fulfillment_product_mappings" m
  ON m."organization_id" = d."organization_id"
 AND m."deleted_at" IS NULL
 AND m."is_active" = true
 AND (
       (m."tiktok_sku_id"     IS NOT NULL AND m."tiktok_sku_id"     = i."sku_id")
    OR (m."seller_sku"        IS NOT NULL AND m."seller_sku"        = i."seller_sku")
    OR (m."tiktok_product_id" IS NOT NULL AND m."tiktok_product_id" = i."product_id")
     )
WHERE d."deleted_at" IS NULL
ORDER BY m."id", d."placement", d."created_at" DESC;
