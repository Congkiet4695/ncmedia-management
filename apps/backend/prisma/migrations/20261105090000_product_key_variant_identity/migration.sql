-- Product Mapping và Design khoá theo BIẾN THỂ: (tiktok_product_id, tiktok_sku_id).
--
-- Lý do: Seller SKU không định danh được biến thể — cùng một sản phẩm có thể có nhiều biến thể cùng Seller SKU, nên khoá
-- (product, seller_sku) buộc chúng dùng chung một SKU nhà cung cấp và một bộ file in. TikTok SKU ID có trên mọi dòng đơn
-- và chỉ thuộc đúng một sản phẩm. Seller SKU vẫn được lưu, chỉ để hiển thị và đối chiếu.
--
-- Bản ghi cũ theo Seller SKU (chỉ bản ghi đang sống, KHÔNG xoá dòng nào):
--   - Khoá ứng với đúng MỘT biến thể (danh mục Products ∪ dòng đơn) ⇒ điền tiktok_sku_id, hoạt động tiếp như cũ.
--   - Khoá ứng với nhiều biến thể / không biến thể nào / tham chiếu cũ mâu thuẫn ⇒ legacy_shared_key = true: KHÔNG tự áp
--     cho đơn nào; người vận hành xác nhận cho từng biến thể ở màn Fulfill (chép cấu hình, file vẫn nguyên).
--
-- Rollback: xem rollback.sql cùng thư mục.

ALTER TABLE "fulfillment_product_mappings" ADD COLUMN "legacy_shared_key" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fulfillment_product_designs" ADD COLUMN "legacy_shared_key" BOOLEAN NOT NULL DEFAULT false;

-- Các index cũ cho phép mỗi Seller SKU đúng một bản ghi, tức cấm chính trường hợp "cùng Seller SKU, khác biến thể".
DROP INDEX "fulfillment_product_mappings_product_sku_unique";
DROP INDEX "fulfillment_product_mappings_product_sku_id_unique";
DROP INDEX "fulfillment_product_designs_active_unique";
DROP INDEX "fulfillment_product_designs_active_sku_id_unique";

-- Biến thể đã biết của từng (tổ chức, sản phẩm, Seller SKU): danh mục đã đồng bộ ∪ dòng đơn (danh mục có thể thiếu biến
-- thể đã ngừng bán). Không lọc bản ghi đã xoá mềm: thêm biến thể chỉ khiến kết quả thận trọng hơn.
CREATE TEMP TABLE "_variant_universe" AS
SELECT org, pid, sku, COUNT(DISTINCT sid) AS n, MIN(sid) AS single
FROM (
  SELECT p."organization_id" AS org, p."tiktok_product_id" AS pid, BTRIM(v."seller_sku") AS sku, v."tiktok_sku_id" AS sid
  FROM "pod_product_variants" v
  JOIN "pod_products" p ON p."id" = v."product_id"
  WHERE BTRIM(COALESCE(v."seller_sku", '')) <> ''
  UNION
  SELECT i."organization_id", i."product_id", BTRIM(i."seller_sku"), i."sku_id"
  FROM "pod_order_items" i
  WHERE BTRIM(COALESCE(i."seller_sku", '')) <> ''
    AND i."product_id" IS NOT NULL
    AND BTRIM(COALESCE(i."sku_id", '')) <> ''
) known
GROUP BY org, pid, sku;

-- ---------------------------------------------------------------------------
-- Product Mapping
-- ---------------------------------------------------------------------------
UPDATE "fulfillment_product_mappings" m
SET "tiktok_sku_id" = u.single
FROM "_variant_universe" u
WHERE m."deleted_at" IS NULL
  AND m."seller_sku" IS NOT NULL
  AND u.org = m."organization_id"
  AND u.pid = m."tiktok_product_id"
  AND u.sku = BTRIM(m."seller_sku")
  AND u.n = 1
  AND (m."tiktok_sku_id" IS NULL OR m."tiktok_sku_id" = u.single);

UPDATE "fulfillment_product_mappings" m
SET "legacy_shared_key" = true
WHERE m."deleted_at" IS NULL
  AND m."seller_sku" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "_variant_universe" u
    WHERE u.org = m."organization_id"
      AND u.pid = m."tiktok_product_id"
      AND u.sku = BTRIM(m."seller_sku")
      AND u.n = 1
      AND m."tiktok_sku_id" = u.single
  );

-- Biến thể đã có bản ghi khác ⇒ giữ bản ghi khai trực tiếp theo SKU ID (rồi bản cũ nhất), bản còn lại thành legacy.
UPDATE "fulfillment_product_mappings"
SET "legacy_shared_key" = true
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "organization_id", "tiktok_product_id", "tiktok_sku_id"
      ORDER BY ("seller_sku" IS NULL) DESC, "created_at", "id"
    ) AS rn
    FROM "fulfillment_product_mappings"
    WHERE "deleted_at" IS NULL AND NOT "legacy_shared_key"
      AND "tiktok_product_id" IS NOT NULL AND "tiktok_sku_id" IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- ---------------------------------------------------------------------------
-- Design
-- ---------------------------------------------------------------------------
UPDATE "fulfillment_product_designs" d
SET "tiktok_sku_id" = u.single
FROM "_variant_universe" u
WHERE d."deleted_at" IS NULL
  AND d."seller_sku" IS NOT NULL
  AND u.org = d."organization_id"
  AND u.pid = d."tiktok_product_id"
  AND u.sku = BTRIM(d."seller_sku")
  AND u.n = 1
  AND (d."tiktok_sku_id" IS NULL OR d."tiktok_sku_id" = u.single);

UPDATE "fulfillment_product_designs" d
SET "legacy_shared_key" = true
WHERE d."deleted_at" IS NULL
  AND d."seller_sku" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "_variant_universe" u
    WHERE u.org = d."organization_id"
      AND u.pid = d."tiktok_product_id"
      AND u.sku = BTRIM(d."seller_sku")
      AND u.n = 1
      AND d."tiktok_sku_id" = u.single
  );

UPDATE "fulfillment_product_designs"
SET "legacy_shared_key" = true
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "organization_id", "tiktok_product_id", "tiktok_sku_id", "placement"
      ORDER BY ("seller_sku" IS NULL) DESC, "created_at", "id"
    ) AS rn
    FROM "fulfillment_product_designs"
    WHERE "deleted_at" IS NULL AND NOT "legacy_shared_key"
      AND "tiktok_product_id" IS NOT NULL AND "tiktok_sku_id" IS NOT NULL
  ) ranked
  WHERE rn > 1
);

DROP TABLE "_variant_universe";

-- ---------------------------------------------------------------------------
-- Ràng buộc mới
-- ---------------------------------------------------------------------------
-- Mỗi biến thể một ánh xạ / mỗi (biến thể × vị trí in) một design đang sống.
CREATE UNIQUE INDEX "fulfillment_product_mappings_variant_unique"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "tiktok_sku_id")
  WHERE "deleted_at" IS NULL
    AND NOT "legacy_shared_key"
    AND "tiktok_product_id" IS NOT NULL
    AND "tiktok_sku_id" IS NOT NULL;

CREATE UNIQUE INDEX "fulfillment_product_designs_variant_unique"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "tiktok_sku_id", "placement")
  WHERE "deleted_at" IS NULL
    AND NOT "legacy_shared_key"
    AND "tiktok_product_id" IS NOT NULL
    AND "tiktok_sku_id" IS NOT NULL;

-- Bản ghi legacy giữ đúng tính duy nhất cũ theo Seller SKU, để việc tra cứu khi xác nhận chỉ ra một kết quả.
CREATE UNIQUE INDEX "fulfillment_product_mappings_legacy_unique"
  ON "fulfillment_product_mappings" ("organization_id", "tiktok_product_id", "seller_sku")
  WHERE "deleted_at" IS NULL
    AND "legacy_shared_key"
    AND "tiktok_product_id" IS NOT NULL
    AND "seller_sku" IS NOT NULL;

CREATE UNIQUE INDEX "fulfillment_product_designs_legacy_unique"
  ON "fulfillment_product_designs" ("organization_id", "tiktok_product_id", "seller_sku", "placement")
  WHERE "deleted_at" IS NULL
    AND "legacy_shared_key"
    AND "tiktok_product_id" IS NOT NULL
    AND "seller_sku" IS NOT NULL;

-- Từ nay bản ghi không phải legacy bắt buộc có SKU ID. NOT VALID như các CHECK khoá trước đó: không quét lại bản ghi cũ.
ALTER TABLE "fulfillment_product_mappings"
  ADD CONSTRAINT "fulfillment_product_mappings_variant_key_check"
  CHECK ("legacy_shared_key" OR "tiktok_sku_id" IS NOT NULL) NOT VALID;

ALTER TABLE "fulfillment_product_designs"
  ADD CONSTRAINT "fulfillment_product_designs_variant_key_check"
  CHECK ("legacy_shared_key" OR "tiktok_sku_id" IS NOT NULL) NOT VALID;
