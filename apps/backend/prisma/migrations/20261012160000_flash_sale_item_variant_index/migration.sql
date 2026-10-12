-- Index cho FK `pod_flash_sale_items.variant_id → pod_product_variants(id) ON DELETE SET NULL`.
--
-- Thiếu index này, mỗi biến thể bị xoá (đồng bộ sản phẩm khi người bán bớt SKU trên TikTok) buộc
-- Postgres Seq Scan toàn bảng `pod_flash_sale_items` để tìm dòng cần SET NULL. Trên dữ liệu thật
-- (~2,08 triệu dòng, 1 GB) mỗi lần quét ~170–250 ms ⇒ xoá 128 biến thể mất ~30 s, vượt timeout 5 s của
-- transaction ghi sản phẩm ⇒ sản phẩm FAILED ở MỌI lượt đồng bộ (trạng thái Partial).
--
-- Chỉ thêm index, không đổi dữ liệu. Lưu ý vận hành: CREATE INDEX (không CONCURRENTLY) chặn GHI vào
-- `pod_flash_sale_items` trong lúc dựng index (vài giây với ~2 triệu dòng) — nên deploy ngoài giờ cao điểm.
CREATE INDEX IF NOT EXISTS "pod_flash_sale_items_variant_id_idx" ON "pod_flash_sale_items"("variant_id");
