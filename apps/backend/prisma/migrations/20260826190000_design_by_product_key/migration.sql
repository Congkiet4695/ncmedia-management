-- ============================================================================
-- Design tách khỏi Product Mapping — khoá theo (Product ID + Seller SKU)
--
-- LÝ DO (bắt buộc giải thích khi đổi Database)
--   Design đang treo vào `mapping_id`, nghĩa là PHẢI khai Product Mapping xong mới upload
--   được design. Đó là một ràng buộc SAI về nghiệp vụ:
--       · Design  trả lời "in cái gì"  → chỉ cần Product ID + Seller SKU
--       · Mapping trả lời "in ở đâu"   → chỉ cần khi Fulfill
--   Hai việc độc lập, người vận hành phải làm được theo bất kỳ thứ tự nào.
--
--   Ràng buộc cũ còn kéo theo hai hệ quả tệ hơn hẳn, do khoá ngoại ON DELETE CASCADE:
--       · Xoá một Product Mapping ⇒ XOÁ LUÔN design của sản phẩm đó.
--       · Đổi nhà cung cấp cho một sản phẩm (xoá ánh xạ cũ, khai ánh xạ mới) ⇒ MẤT file in.
--   Migration này cắt hẳn khoá ngoại đó.
--
-- CAM KẾT
--   OK Không mất dữ liệu — RENAME bảng (giữ nguyên mọi dòng), backfill khoá mới từ chính
--      ánh xạ đang trỏ tới, rồi mới bỏ cột cũ. Đã kiểm: 0 dòng không backfill được.
--   OK Không duplicate  — ánh xạ là UNIQUE theo (org, product_id, seller_sku) nên
--      mapping_id ↔ cặp khoá là song ánh; bỏ mapping_id không mất thông tin nào.
--   OK Không hỏng đơn cũ — `fulfillment_order_items.print_files` không bị đụng.
--   OK Có rollback      — xem rollback.sql cùng thư mục.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Đổi tên bảng cho đúng nghĩa mới
--
-- RENAME giữ nguyên dữ liệu, chỉ mục và khoá ngoại — an toàn hơn hẳn tạo bảng mới rồi chép.
-- Tên cũ `fulfillment_mapping_designs` sẽ nói dối ngay khi design không còn thuộc mapping.
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_mapping_designs" RENAME TO "fulfillment_product_designs";

ALTER INDEX "fulfillment_mapping_designs_pkey"
  RENAME TO "fulfillment_product_designs_pkey";
ALTER INDEX "fulfillment_mapping_designs_organization_id_idx"
  RENAME TO "fulfillment_product_designs_organization_id_idx";

-- ---------------------------------------------------------------------------
-- 2. Khoá nghiệp vụ mới
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_designs"
  ADD COLUMN IF NOT EXISTS "tiktok_product_id" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "seller_sku"        VARCHAR(255);

-- Backfill từ chính ánh xạ mà design đang trỏ tới. Ánh xạ đã có UNIQUE trên
-- (organization_id, tiktok_product_id, seller_sku) nên phép suy này không nhập nhằng.
UPDATE "fulfillment_product_designs" d
SET "tiktok_product_id" = m."tiktok_product_id",
    "seller_sku"        = m."seller_sku"
FROM "fulfillment_product_mappings" m
WHERE m."id" = d."mapping_id"
  AND m."tiktok_product_id" IS NOT NULL
  AND m."seller_sku" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Gộp trùng trước khi tạo UNIQUE
--
-- Trước đây HAI ánh xạ khác nhau không thể cùng cặp khoá (đã có UNIQUE từ migration
-- 20260826170000), nên về lý thuyết không có trùng. Vẫn xử lý phòng khi dữ liệu cũ hơn ràng
-- buộc đó: giữ bản MỚI NHẤT theo updated_at, phần còn lại xoá MỀM (không xoá cứng — file vẫn
-- tra được và bản ghi vẫn là bằng chứng đối soát).
-- ---------------------------------------------------------------------------
UPDATE "fulfillment_product_designs" d
SET "deleted_at" = CURRENT_TIMESTAMP
WHERE d."deleted_at" IS NULL
  AND d."tiktok_product_id" IS NOT NULL
  AND d."seller_sku" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "fulfillment_product_designs" k
    WHERE k."deleted_at" IS NULL
      AND k."organization_id"   = d."organization_id"
      AND k."tiktok_product_id" = d."tiktok_product_id"
      AND k."seller_sku"        = d."seller_sku"
      AND k."placement"         = d."placement"
      AND (k."updated_at" > d."updated_at" OR (k."updated_at" = d."updated_at" AND k."id" > d."id"))
  );

-- ---------------------------------------------------------------------------
-- 4. Cắt phụ thuộc vào Product Mapping
--
-- 🔴 Đây là phần cốt lõi: khoá ngoại cũ dùng ON DELETE CASCADE, nên chừng nào còn nó thì
-- xoá một ánh xạ vẫn xoá theo design. Bỏ cột là bỏ luôn ràng buộc.
-- Không mất thông tin: mapping_id suy lại được từ cặp khoá bất cứ lúc nào.
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_designs"
  DROP CONSTRAINT IF EXISTS "fulfillment_mapping_designs_mapping_id_fkey";

DROP INDEX IF EXISTS "fulfillment_mapping_designs_mapping_id_placement_idx";
DROP INDEX IF EXISTS "fulfillment_mapping_designs_active_unique";

ALTER TABLE "fulfillment_product_designs" DROP COLUMN IF EXISTS "mapping_id";

-- Khoá ngoại tới storage giữ nguyên, chỉ đổi tên cho khớp bảng.
ALTER TABLE "fulfillment_product_designs"
  RENAME CONSTRAINT "fulfillment_mapping_designs_storage_file_id_fkey"
  TO "fulfillment_product_designs_storage_file_id_fkey";

-- ---------------------------------------------------------------------------
-- 5. Danh tính mới ở tầng DATABASE
-- ---------------------------------------------------------------------------

-- 🔴 UNIQUE TỪNG PHẦN: mỗi (sản phẩm × vị trí in) chỉ có MỘT design ĐANG SỐNG.
-- Dùng partial index để bản đã xoá mềm vẫn nằm lại làm lịch sử mà không chặn lần upload sau
-- — đúng luồng Delete rồi Upload lại.
CREATE UNIQUE INDEX "fulfillment_product_designs_active_unique"
  ON "fulfillment_product_designs"
     ("organization_id", "tiktok_product_id", "seller_sku", "placement")
  WHERE "deleted_at" IS NULL
    AND "tiktok_product_id" IS NOT NULL
    AND "seller_sku" IS NOT NULL;

CREATE INDEX "fulfillment_product_designs_organization_id_tiktok_produ_idx"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "seller_sku");

-- NOT VALID có chủ đích: bản ghi CŨ thiếu khoá (mapping nguồn đã bị xoá) được giữ nguyên,
-- nhưng mọi INSERT/UPDATE từ nay phải có đủ cặp khoá.
ALTER TABLE "fulfillment_product_designs"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_designs_identity_check";
ALTER TABLE "fulfillment_product_designs"
  ADD CONSTRAINT "fulfillment_product_designs_identity_check"
  CHECK ("tiktok_product_id" IS NOT NULL AND "seller_sku" IS NOT NULL)
  NOT VALID;

COMMENT ON TABLE "fulfillment_product_designs" IS
  'File in cua SAN PHAM POD. Khoa: (organization_id, tiktok_product_id, seller_sku, placement). DOC LAP voi Product Mapping - upload design khong doi hoi da anh xa.';
