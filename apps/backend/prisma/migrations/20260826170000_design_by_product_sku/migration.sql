-- ============================================================================
-- Design theo (Product ID + Seller SKU)
--
-- LÝ DO (bắt buộc giải thích khi đổi Database)
--   Yêu cầu nghiệp vụ: "Một bộ Design thuộc về Product ID + Seller SKU. Không thuộc Order."
--   Cấu trúc trước đó cho phép ghép ánh xạ theo BA khoá rời rạc với thứ tự ưu tiên
--   (tiktok_sku_id -> seller_sku -> tiktok_product_id). Hệ quả: cùng một sản phẩm có thể rơi
--   vào hai bản ghi ánh xạ khác nhau tuỳ đơn hàng mang khoá nào => hai bộ Design cho một sản
--   phẩm => đúng cái mà yêu cầu cấm. Danh tính phải là MỘT cặp khoá, và phải được DATABASE
--   bảo đảm chứ không phải trông chờ vào kỷ luật của tầng ứng dụng.
--
-- CAM KẾT
--   OK Không mất dữ liệu  — không DROP bảng nào, không DELETE dòng nào (chỉ xoá mềm bản ghi
--                           trùng lặp sau khi đã gộp Design của chúng về bản giữ lại).
--   OK Không duplicate    — gộp trùng TRƯỚC khi tạo UNIQUE, bản mới nhất theo updated_at thắng.
--   OK Không hỏng đơn cũ  — fulfillment_order_items.print_files (ảnh chụp lúc gửi xưởng in)
--                           không bị đụng tới một dòng nào.
--   OK Có rollback        — xem rollback.sql cùng thư mục.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Base Cost thuộc về SẢN PHẨM
-- ---------------------------------------------------------------------------
ALTER TABLE "fulfillment_product_mappings"
  ADD COLUMN IF NOT EXISTS "base_cost" DECIMAL(18,4);

COMMENT ON COLUMN "fulfillment_product_mappings"."base_cost" IS
  'Gia von nha cung cap cho SKU nay. Chep sang fulfillment_order_items.base_cost luc gui don (anh chup bat bien).';

-- ---------------------------------------------------------------------------
-- 2. Bù khoá còn thiếu cho bản ghi cũ
--
-- Ánh xạ cũ có thể chỉ khai một trong ba khoá. Suy ra phần thiếu từ chính các dòng hàng đã
-- đồng bộ — nguồn duy nhất biết chắc "product_id nào đi cùng seller_sku nào". Chỉ nhận suy
-- luận KHÔNG NHẬP NHẰNG: nếu một khoá cũ dẫn tới nhiều cặp khác nhau thì bỏ qua, để người
-- vận hành tự quyết, hơn là đoán sai rồi gán design vào nhầm sản phẩm.
-- ---------------------------------------------------------------------------

-- 2a. Có tiktok_sku_id => suy ra cặp (product_id, seller_sku)
WITH resolved AS (
  SELECT i."sku_id",
         i."organization_id",
         MIN(i."product_id")  AS product_id,
         MIN(i."seller_sku")  AS seller_sku
  FROM "pod_order_items" i
  WHERE i."sku_id" IS NOT NULL
    AND i."product_id" IS NOT NULL
    AND i."seller_sku" IS NOT NULL
  GROUP BY i."sku_id", i."organization_id"
  HAVING COUNT(DISTINCT i."product_id") = 1
     AND COUNT(DISTINCT i."seller_sku") = 1
)
UPDATE "fulfillment_product_mappings" m
SET "tiktok_product_id" = COALESCE(m."tiktok_product_id", r."product_id"),
    "seller_sku"        = COALESCE(m."seller_sku",        r."seller_sku")
FROM resolved r
WHERE m."tiktok_sku_id" = r."sku_id"
  AND m."organization_id" = r."organization_id"
  AND m."deleted_at" IS NULL
  AND (m."tiktok_product_id" IS NULL OR m."seller_sku" IS NULL);

-- 2b. Có seller_sku, thiếu product_id
WITH resolved AS (
  SELECT i."seller_sku", i."organization_id", MIN(i."product_id") AS product_id
  FROM "pod_order_items" i
  WHERE i."seller_sku" IS NOT NULL AND i."product_id" IS NOT NULL
  GROUP BY i."seller_sku", i."organization_id"
  HAVING COUNT(DISTINCT i."product_id") = 1
)
UPDATE "fulfillment_product_mappings" m
SET "tiktok_product_id" = r."product_id"
FROM resolved r
WHERE m."seller_sku" = r."seller_sku"
  AND m."organization_id" = r."organization_id"
  AND m."deleted_at" IS NULL
  AND m."tiktok_product_id" IS NULL;

-- 2c. Có product_id, thiếu seller_sku (chỉ khi sản phẩm có DUY NHẤT một seller_sku)
WITH resolved AS (
  SELECT i."product_id", i."organization_id", MIN(i."seller_sku") AS seller_sku
  FROM "pod_order_items" i
  WHERE i."product_id" IS NOT NULL AND i."seller_sku" IS NOT NULL
  GROUP BY i."product_id", i."organization_id"
  HAVING COUNT(DISTINCT i."seller_sku") = 1
)
UPDATE "fulfillment_product_mappings" m
SET "seller_sku" = r."seller_sku"
FROM resolved r
WHERE m."tiktok_product_id" = r."product_id"
  AND m."organization_id" = r."organization_id"
  AND m."deleted_at" IS NULL
  AND m."seller_sku" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Gộp ánh xạ trùng cặp khoá (bản mới nhất thắng)
--
-- Trước sprint này (organization, account, seller_sku) mới là UNIQUE, nên HAI tài khoản nhà
-- cung cấp khác nhau vẫn khai được cùng một sản phẩm => hai bộ Design. Yêu cầu:
-- "Nếu nhiều Order cùng Product ID + Seller SKU có cùng Design: chỉ giữ một bản.
--  Nếu khác nhau: giữ Design mới nhất theo Updated At."
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE "_mapping_merge" AS
SELECT dup_id, keep_id FROM (
  SELECT m."id" AS dup_id,
         first_value(m."id") OVER (
           PARTITION BY m."organization_id", m."tiktok_product_id", m."seller_sku"
           ORDER BY m."updated_at" DESC, m."created_at" DESC, m."id"
         ) AS keep_id
  FROM "fulfillment_product_mappings" m
  WHERE m."deleted_at" IS NULL
    AND m."tiktok_product_id" IS NOT NULL
    AND m."seller_sku" IS NOT NULL
) ranked
WHERE dup_id <> keep_id;

-- 3a. Chuyển Design của bản bị gộp sang bản giữ lại — CHỈ khi bản giữ lại còn trống vị trí
--     đó. Bản giữ lại là bản mới nhất, nên design của nó luôn thắng (không ghi đè).
UPDATE "fulfillment_mapping_designs" d
SET "mapping_id" = mm.keep_id,
    "updated_at" = CURRENT_TIMESTAMP
FROM "_mapping_merge" mm
WHERE d."mapping_id" = mm.dup_id
  AND d."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "fulfillment_mapping_designs" k
    WHERE k."mapping_id" = mm.keep_id
      AND k."placement" = d."placement"
      AND k."deleted_at" IS NULL
  );

-- 3b. Design còn lại của bản bị gộp (vị trí đã có ở bản giữ lại) => xoá mềm, KHÔNG xoá cứng:
--     file vẫn tra được, và unique index bên dưới không bị vướng.
UPDATE "fulfillment_mapping_designs" d
SET "deleted_at" = CURRENT_TIMESTAMP
FROM "_mapping_merge" mm
WHERE d."mapping_id" = mm.dup_id
  AND d."deleted_at" IS NULL;

-- 3c. Xoá mềm bản ghi ánh xạ bị gộp.
UPDATE "fulfillment_product_mappings" m
SET "deleted_at" = CURRENT_TIMESTAMP,
    "is_active"  = false,
    "note"       = COALESCE(m."note" || ' | ', '')
                   || 'Gop vao anh xa ' || mm.keep_id::text
                   || ' (migration 20260826170000: danh tinh = Product ID + Seller SKU)'
FROM "_mapping_merge" mm
WHERE m."id" = mm.dup_id;

DROP TABLE "_mapping_merge";

-- ---------------------------------------------------------------------------
-- 4. Danh tính mới ở tầng DATABASE
-- ---------------------------------------------------------------------------

-- Chỉ mục cũ theo (organization, account, seller_sku): cho phép hai nhà cung cấp cùng khai
-- một Seller SKU => hai bộ Design cho một sản phẩm. Phải bỏ.
DROP INDEX IF EXISTS "fulfillment_product_mappings_seller_sku_unique";

CREATE UNIQUE INDEX "fulfillment_product_mappings_product_sku_unique"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "seller_sku")
  WHERE "deleted_at" IS NULL
    AND "tiktok_product_id" IS NOT NULL
    AND "seller_sku" IS NOT NULL;

-- Chỉ mục phục vụ ĐÚNG luật ghép mới (một lượt đọc cho cả trang đơn hàng).
CREATE INDEX IF NOT EXISTS "fulfillment_product_mappings_organization_id_tiktok_produc_idx"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "seller_sku");

-- tiktok_sku_id không còn là khoá ghép => chỉ mục riêng cho nó chỉ còn là chi phí ghi.
DROP INDEX IF EXISTS "fulfillment_product_mappings_organization_id_tiktok_sku_id_idx";
DROP INDEX IF EXISTS "fulfillment_product_mappings_organization_id_tiktok_product_idx";

-- CHECK cũ: "ít nhất MỘT trong ba khoá" — quá lỏng cho danh tính là một CẶP.
ALTER TABLE "fulfillment_product_mappings"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_mappings_key_check";

-- NOT VALID có chủ đích: bản ghi CŨ thiếu khoá được giữ nguyên (không mất dữ liệu), nhưng
-- mọi INSERT/UPDATE từ nay phải có đủ cặp khoá. Muốn sửa một bản ghi cũ => buộc phải điền đủ.
ALTER TABLE "fulfillment_product_mappings"
  DROP CONSTRAINT IF EXISTS "fulfillment_product_mappings_identity_check";
ALTER TABLE "fulfillment_product_mappings"
  ADD CONSTRAINT "fulfillment_product_mappings_identity_check"
  CHECK ("tiktok_product_id" IS NOT NULL AND "seller_sku" IS NOT NULL)
  NOT VALID;

-- ---------------------------------------------------------------------------
-- 5. Chuyển Design cũ còn sót từ Order Item sang Product Mapping
--
-- Migration trước (20260826150000) đã chuyển theo luật ghép CŨ (ưu tiên tiktok_sku_id).
-- Lần này ghép theo ĐÚNG luật mới — cặp (product_id, seller_sku) — nên có thể vớt thêm
-- những dòng lần trước bỏ sót.
--
-- Chỉ ghi vào vị trí CÒN TRỐNG: design đang dùng của Product Mapping là bản người vận hành
-- chủ động upload, luôn mới hơn dữ liệu lịch sử — không được ghi đè.
-- ---------------------------------------------------------------------------
INSERT INTO "fulfillment_mapping_designs"
  ("id", "organization_id", "mapping_id", "placement", "storage_file_id", "version",
   "created_at", "updated_at", "created_by", "updated_by")
SELECT DISTINCT ON (m."id", d."placement")
       gen_random_uuid(), d."organization_id", m."id", d."placement", d."storage_file_id",
       d."version", d."created_at", CURRENT_TIMESTAMP, d."created_by", d."updated_by"
FROM "pod_order_item_designs" d
JOIN "pod_order_items" i
  ON i."id" = d."order_item_id"
JOIN "fulfillment_product_mappings" m
  ON  m."organization_id"   = d."organization_id"
  AND m."deleted_at"        IS NULL
  AND m."is_active"         = true
  AND m."tiktok_product_id" = i."product_id"
  AND m."seller_sku"        = i."seller_sku"
WHERE d."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "fulfillment_mapping_designs" k
    WHERE k."mapping_id" = m."id"
      AND k."placement"  = d."placement"
      AND k."deleted_at" IS NULL
  )
-- "Giữ Design mới nhất theo Updated At" — đúng câu chữ của yêu cầu.
ORDER BY m."id", d."placement", d."updated_at" DESC, d."created_at" DESC;

-- ---------------------------------------------------------------------------
-- 6. Bảng design theo Order Item chuyển sang trạng thái LƯU TRỮ
--
-- KHÔNG DROP: dòng nào thuộc sản phẩm chưa khai ánh xạ thì không có chỗ để chuyển tới, drop
-- là mất vĩnh viễn thông tin "đơn này từng in file nào". Backend đã gỡ toàn bộ đường ghi
-- (controller/service/repository), nên từ đây bảng chỉ còn được đọc khi tra cứu lịch sử.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE "pod_order_item_designs" IS
  'LUU TRU LICH SU, CHI DOC. Design hien nam o fulfillment_mapping_designs (khoa: Product ID + Seller SKU). Khong co code nao ghi vao bang nay.';
