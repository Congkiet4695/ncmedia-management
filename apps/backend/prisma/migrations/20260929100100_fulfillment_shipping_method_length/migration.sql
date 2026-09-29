-- Mở rộng cột phương thức vận chuyển 40 → 255 ký tự.
--
-- Vì sao: Sellerwix dùng `code` do nhà cung cấp tự đặt theo từng biến thể (tài liệu "Get available
-- shipping methods of variant", ví dụ `"UPS Mail Innovations Expedited"`), không phải enum ngắn như
-- MangoTeePrints (`standard`, `priority`…). Tài liệu KHÔNG giới hạn độ dài `code`; 40 ký tự đủ cho
-- Mango nhưng sẽ làm hỏng lượt ghi bản ghi fulfillment của Sellerwix giữa luồng gửi đơn.
--
-- Chỉ NỚI kiểu — dữ liệu hiện có giữ nguyên, không khoá bảng lâu (VARCHAR nới rộng không viết lại bảng).

-- AlterTable
ALTER TABLE "fulfillment_orders" ALTER COLUMN "shipping_method" TYPE VARCHAR(255);

-- AlterTable
ALTER TABLE "fulfillment_accounts" ALTER COLUMN "default_shipping_method" TYPE VARCHAR(255);
