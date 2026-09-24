-- Tài khoản nhà cung cấp DÙNG CHUNG toàn nền tảng.
--
-- Vì sao: danh mục sản phẩm của MangoTeePrints là dữ liệu của NHÀ CUNG CẤP, không phải của
-- từng tổ chức. Trước đây mỗi tổ chức phải tự khai tài khoản và tự đồng bộ ⇒ mỗi tổ chức một
-- bản sao danh mục y hệt nhau (284 sản phẩm × N tổ chức), và dữ liệu giữa các tổ chức lệch
-- nhau tuỳ thời điểm ai bấm Sync.
--
-- `is_global = true` ⇒ tài khoản do Super Admin (Organization `is_platform`) sở hữu, MỌI tổ
-- chức đều đọc được danh mục của nó. Danh mục vẫn chỉ có MỘT bản, khoá theo `account_id`
-- (unique `(account_id, external_product_id)` đã có sẵn) — không nhân bản theo tổ chức.
--
-- Tương thích ngược: mặc định `false` ⇒ mọi tài khoản đang có giữ nguyên hành vi cũ
-- (riêng của tổ chức). Không đụng tới dữ liệu danh mục, ánh xạ hay đơn đã gửi.

-- AlterTable
ALTER TABLE "fulfillment_accounts"
  ADD COLUMN "is_global" BOOLEAN NOT NULL DEFAULT false;

-- Tra nhanh danh sách nhà cung cấp dùng chung (mọi tổ chức đều hỏi danh sách này khi fulfill).
CREATE INDEX "fulfillment_accounts_is_global_idx"
  ON "fulfillment_accounts" ("is_global")
  WHERE "is_global" = true AND "deleted_at" IS NULL;
