-- ===========================================================================
-- Giá `0` ở tổ hợp SKU nghĩa là **CHƯA ĐẶT**, không phải "bán 0 đồng".
--
-- Lưới SKU gửi `Number('')` cho ô để trống — ra đúng số 0. Những dòng đó mang một "giá hợp
-- lệ" bằng 0, che mất phương án dự phòng (giá gốc − % giảm, Pricing Template) và bị cổng
-- validate chặn với thông điệp "chưa có giá bán hợp lệ" dù người dùng đã khai Retail Price.
--
-- Chuẩn hoá về NULL. Không mất thông tin: TikTok từ chối SKU giá 0, nên 0 chưa bao giờ là
-- một mức giá dùng được — nó chỉ là dấu vết của một ô để trống.
--
-- KHÔNG đụng tới `quantity`: tồn kho 0 là một giá trị có nghĩa (hết hàng).
-- ===========================================================================

UPDATE "pod_sku_template_items" SET "sale_price" = NULL WHERE "sale_price" <= 0;
UPDATE "pod_sku_template_items" SET "retail_price" = NULL WHERE "retail_price" <= 0;
UPDATE "pod_sku_template_items" SET "discount" = NULL WHERE "discount" <= 0;

UPDATE "pod_sku_templates" SET "default_sale_price" = NULL WHERE "default_sale_price" <= 0;
UPDATE "pod_sku_templates" SET "default_retail_price" = NULL WHERE "default_retail_price" <= 0;
UPDATE "pod_sku_templates" SET "default_discount" = NULL WHERE "default_discount" <= 0;
