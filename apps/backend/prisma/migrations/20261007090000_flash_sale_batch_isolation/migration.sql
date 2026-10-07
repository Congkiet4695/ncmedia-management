-- Flash Sale: kết quả từng lô của lượt publish + lô đã gửi từng dòng.
-- Một lô hỏng không còn chặn các lô sau; màn hình cần biết lô nào SUCCEEDED / PARTIAL / FAILED / SKIPPED
-- và SKU lỗi nằm ở lô nào. Cả hai cột nullable — dữ liệu cũ không cần backfill.
ALTER TABLE "pod_flash_sales" ADD COLUMN "publish_batch_results" JSONB;
ALTER TABLE "pod_flash_sale_items" ADD COLUMN "publish_batch" INTEGER;
