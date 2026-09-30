-- Design của sản phẩm có HAI nguồn: file upload lên Storage Module, hoặc URL công khai do
-- người vận hành nhập (file đã nằm sẵn trên một kho công khai — không tải về rồi upload lại).
--
-- Additive + backward compatible: mọi bản ghi hiện có đều có `storage_file_id` nên thoả CHECK.
-- CHECK bắt ĐÚNG MỘT nguồn: thiếu cả hai ⇒ không có gì để in; có cả hai ⇒ không biết in cái nào.

ALTER TABLE "fulfillment_product_designs"
  ALTER COLUMN "storage_file_id" DROP NOT NULL,
  ADD COLUMN "source_url" VARCHAR(2048);

ALTER TABLE "fulfillment_product_designs"
  ADD CONSTRAINT "fulfillment_product_designs_exactly_one_source_chk"
  CHECK (("storage_file_id" IS NOT NULL) <> ("source_url" IS NOT NULL));
