-- Con trỏ tiến độ RIÊNG cho việc lấy thuộc tính danh mục.
--
-- Trước migration này, vòng lấy thuộc tính xếp thứ tự theo `synced_at` — cùng cột mà lượt
-- đồng bộ CÂY DANH MỤC ghi đè cho toàn bộ ~11.892 bản ghi trong vài giây. Hệ quả: mỗi lần
-- đồng bộ danh mục là xoá sạch tiến độ lấy thuộc tính, vòng quét không bao giờ đi hết
-- 9.873 danh mục lá. Tách thành cột riêng để hai việc không giẫm lên nhau.
--
-- NULL = danh mục chưa bao giờ lấy được thuộc tính ⇒ được ưu tiên quét trước.
ALTER TABLE "pod_product_categories"
  ADD COLUMN "attributes_synced_at" TIMESTAMPTZ(6);

-- Danh mục ĐÃ có thuộc tính thì coi như đã quét: lấy mốc gần nhất trong đám thuộc tính của
-- nó. Không có bước này, dữ liệu cũ sẽ bị quét lại từ đầu một cách vô ích.
UPDATE "pod_product_categories" c
SET "attributes_synced_at" = a."last_synced"
FROM (
  SELECT "category_id", MAX("synced_at") AS "last_synced"
  FROM "pod_category_attributes"
  GROUP BY "category_id"
) a
WHERE a."category_id" = c."id";

-- Đúng thứ tự vòng quét đọc: danh mục lá, NULL trước rồi tới cũ nhất.
CREATE INDEX "pod_product_categories_is_leaf_attributes_synced_at_idx"
  ON "pod_product_categories" ("is_leaf", "attributes_synced_at");
