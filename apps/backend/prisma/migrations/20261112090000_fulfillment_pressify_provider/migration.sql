-- Nhà cung cấp fulfillment PRESSIFY.
--
-- Nguồn: Pressify Seller API (https://pressify.us/docs/api/index.html, phiên bản 2026-09-14).
-- Chi tiết: docs/fulfillment/pressify.md
--
-- CHỈ thêm một giá trị enum. Không đổi / xoá giá trị cũ, không thêm bảng hay cột:
--   · thông tin xác thực (Store API key)  → `fulfillment_accounts.api_key_enc` (đã có, AES-256-GCM)
--   · cấu hình không bí mật (bậc giá)      → `fulfillment_accounts.provider_config` (đã có)
--   · danh mục sản phẩm / biến thể        → `fulfillment_*` + Global Catalog `provider_catalog_*`
--                                            (đã có, khoá (provider, external_*_id))
--
-- An toàn khi chạy trên database đang có dữ liệu: `ADD VALUE IF NOT EXISTS` chỉ thêm nhãn vào enum,
-- không khoá bảng dữ liệu và không đụng tới hàng nào. Rollback: không cần xoá giá trị enum (PostgreSQL
-- không hỗ trợ DROP VALUE) — giá trị không được dùng thì không ảnh hưởng gì.

-- AlterEnum
ALTER TYPE "fulfillment_provider" ADD VALUE IF NOT EXISTS 'PRESSIFY';
