-- Bia mộ cho Flash Sale bị XOÁ CỨNG (xoá hàng loạt / xoá từng đợt).
--
-- Trước đây xoá Flash Sale là xoá mềm, và chính bản ghi xoá mềm chặn "Sync from TikTok" import lại
-- đợt đó (khớp theo shop_id + provider_flash_sale_id kể cả bản ghi đã xoá). Xoá cứng làm mất bản ghi
-- ấy ⇒ bảng này giữ đúng khoá khớp để đồng bộ tiếp tục BỎ QUA activity người dùng đã xoá.
--
-- Chỉ TẠO bảng mới, không đổi / không xoá dữ liệu hiện có. An toàn khi deploy giờ cao điểm.
CREATE TABLE "pod_flash_sale_tombstones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "provider_flash_sale_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "pod_flash_sale_tombstones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pod_flash_sale_tombstones_organization_id_idx" ON "pod_flash_sale_tombstones"("organization_id");

CREATE UNIQUE INDEX "pod_flash_sale_tombstones_shop_id_provider_flash_sale_id_key" ON "pod_flash_sale_tombstones"("shop_id", "provider_flash_sale_id");

ALTER TABLE "pod_flash_sale_tombstones" ADD CONSTRAINT "pod_flash_sale_tombstones_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pod_tiktok_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
