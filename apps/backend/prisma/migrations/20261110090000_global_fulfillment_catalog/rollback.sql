-- Hoàn tác thủ công migration 20261110090000 (Global Fulfillment Catalog).
--
-- BƯỚC 1 (đủ để quay về hành vi cũ, KHÔNG cần chạy file này): đặt GLOBAL_FULFILLMENT_CATALOG_ENABLED=false
-- và (tuỳ chọn) GLOBAL_FULFILLMENT_CATALOG_DUAL_WRITE_ENABLED=false rồi khởi động lại backend.
--
-- BƯỚC 2 (chỉ khi muốn gỡ hẳn lớp mới): chạy file này SAU khi đã tắt cả hai cờ và deploy code không còn đọc /
-- ghi các bảng dưới. Không bảng cũ nào (fulfillment_catalogues/products/variants, product mappings, designs,
-- đơn hàng) phụ thuộc vào chúng ⇒ không mất dữ liệu nghiệp vụ; dữ liệu ở đây dựng lại được bằng
-- scripts/backfill-global-catalog.ts --apply.
--
-- Con trước cha (khoá ngoại RESTRICT từ lớp theo tài khoản sang lớp global).
DROP TABLE IF EXISTS "fulfillment_account_variants";
DROP TABLE IF EXISTS "fulfillment_account_products";
DROP TABLE IF EXISTS "fulfillment_account_catalogues";
DROP TABLE IF EXISTS "provider_catalog_variants";
DROP TABLE IF EXISTS "provider_catalog_products";
DROP TABLE IF EXISTS "provider_catalog_catalogues";
-- Sau đó xoá dòng "20261110090000_global_fulfillment_catalog" khỏi bảng _prisma_migrations nếu muốn Prisma
-- áp lại migration này về sau.
