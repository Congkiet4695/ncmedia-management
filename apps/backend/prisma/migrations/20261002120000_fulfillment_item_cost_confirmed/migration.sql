-- Phân biệt giá vốn NHÀ CUNG CẤP ĐÃ XÁC NHẬN với ảnh chụp giá catalog chép vào dòng hàng lúc gửi.
--
-- `base_cost` của `fulfillment_order_items` có hai nguồn: (1) ảnh chụp giá biến thể lúc gửi (dự
-- phòng), (2) số nhà cung cấp báo về (Create Order / Get Order Detail / webhook). Trước đây không
-- phân biệt được, nên màn hình hiển thị (1) như thể là giá thật. Cột mới ghi thời điểm nguồn (2)
-- được áp; NULL = chưa được nhà cung cấp xác nhận ⇒ giao diện báo "chờ báo giá", lợi nhuận chưa tính.
--
-- Backfill THẬN TRỌNG (chỉ nơi kiểm chứng được): đơn Mango đã gửi mà response lưu lại có giá vốn
-- cho MỌI dòng — luồng tạo đơn đã áp đúng các số đó vào dòng hàng. Còn lại để NULL; lượt đồng bộ
-- kế tiếp (đơn chưa kết thúc) sẽ xác nhận.

ALTER TABLE "fulfillment_order_items" ADD COLUMN "base_cost_confirmed_at" TIMESTAMPTZ(6);

UPDATE "fulfillment_order_items" AS i
SET "base_cost_confirmed_at" = COALESCE(o."last_synced_at", o."submitted_at")
FROM "fulfillment_orders" AS o
WHERE i."fulfillment_order_id" = o."id"
  AND i."deleted_at" IS NULL
  AND i."base_cost" IS NOT NULL
  AND o."provider" = 'MANGO'
  AND o."submitted_at" IS NOT NULL
  AND jsonb_typeof(o."raw_response" -> 'items') = 'array'
  AND jsonb_array_length(o."raw_response" -> 'items') > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(o."raw_response" -> 'items') AS e
    WHERE e ->> 'base_cost' IS NULL
  );
