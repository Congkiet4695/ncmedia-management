-- Rollback: chỉ chạy được khi KHÔNG còn design nguồn URL (storage_file_id NULL).
ALTER TABLE "fulfillment_product_designs" DROP CONSTRAINT "fulfillment_product_designs_exactly_one_source_chk";
ALTER TABLE "fulfillment_product_designs" DROP COLUMN "source_url";
ALTER TABLE "fulfillment_product_designs" ALTER COLUMN "storage_file_id" SET NOT NULL;
