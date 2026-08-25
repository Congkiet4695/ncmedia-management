-- Postgres cắt tên chỉ mục ở 63 ký tự, Prisma cũng cắt nhưng theo cách khác một chữ.
-- Đổi về đúng tên Prisma mong đợi để `migrate diff` không còn báo lệch.

ALTER INDEX "pod_listing_payloads_shop_id_draft_listing_id_listing_templa_ke"
  RENAME TO "pod_listing_payloads_shop_id_draft_listing_id_listing_templ_key";
