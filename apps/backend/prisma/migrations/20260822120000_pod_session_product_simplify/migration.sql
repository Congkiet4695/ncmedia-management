-- ===========================================================================
-- Draft Product chỉ còn TIÊU ĐỀ + ẢNH GỐC.
--
-- File import rút về đúng 11 cột (`title` + `URL1..URL10`), nên Draft Product không còn
-- mang mô tả hay biến thể: hai thứ đó — cùng danh mục, thuộc tính, giá, tồn, kiện hàng —
-- được dựng từ bộ template của session lúc Start Listing.
--
-- Bảng biến thể vì thế không còn nguồn nào ghi vào: DROP thay vì để lại một bảng rỗng mà
-- lần đọc code sau sẽ tưởng là đang dùng.
-- ===========================================================================

-- `sort_order` đổi tên thành `import_order` cho đúng nghĩa: đây là thứ tự dòng trong file
-- import, cộng dồn qua các lần import bổ sung. RENAME (không DROP + ADD) để giữ nguyên dữ
-- liệu của các lượt đăng đang có.
ALTER TABLE "pod_listing_session_products" RENAME COLUMN "sort_order" TO "import_order";
ALTER INDEX "pod_listing_session_products_session_id_sort_order_idx"
  RENAME TO "pod_listing_session_products_session_id_import_order_idx";

ALTER TABLE "pod_listing_session_products" DROP COLUMN "description";
ALTER TABLE "pod_listing_session_products" DROP COLUMN "handle";

DROP TABLE "pod_listing_session_product_variants";
