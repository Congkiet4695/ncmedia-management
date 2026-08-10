-- ---------------------------------------------------------------------------
-- Seller của TikTok Account: chuyển từ `User` sang `Employee`.
--
-- Lý do: "Seller phụ trách" là vai trò NGHIỆP VỤ nên phải gắn với hồ sơ nhân sự,
-- không phải tài khoản đăng nhập (ADR-007 — User lo Authentication, Employee lo
-- Business Information). Quy tắc mới: chỉ Employee đang ACTIVE và có Role `EMPLOYEE`
-- được phân công; Admin/Fulfillment KHÔNG phải seller.
--
-- 🔴 Dữ liệu cũ được BẢO TOÀN tối đa: mỗi `seller_user_id` được ánh xạ sang đúng
-- Employee của user đó (quan hệ 1-1 `employees.user_id`) trong CÙNG Organization.
-- Trường hợp user không có hồ sơ Employee (điển hình là Admin đã link kết nối) thì
-- `seller_id` để NULL — đúng theo quy tắc mới, account đó hiển thị "Chưa phân công"
-- và Admin phân công lại bằng API/màn hình TikTok Account.
-- ---------------------------------------------------------------------------

-- 1. Thêm cột mới (nullable — chưa phân công là trạng thái hợp lệ).
ALTER TABLE "pod_tiktok_accounts" ADD COLUMN "seller_id" UUID;

-- 2. Chuyển dữ liệu: user → employee tương ứng (cùng tổ chức, chưa xoá mềm).
UPDATE "pod_tiktok_accounts" a
   SET "seller_id" = e."id"
  FROM "employees" e
 WHERE e."user_id" = a."seller_user_id"
   AND e."organization_id" = a."organization_id"
   AND e."deleted_at" IS NULL
   AND a."seller_user_id" IS NOT NULL;

-- 3. Gỡ cột cũ (kéo theo index + khoá ngoại cũ).
DROP INDEX IF EXISTS "pod_tiktok_accounts_seller_user_id_idx";
ALTER TABLE "pod_tiktok_accounts" DROP COLUMN "seller_user_id";

-- 4. Index + khoá ngoại mới.
-- ON DELETE SET NULL: xoá nhân viên thì kết nối trở về "chưa phân công",
-- KHÔNG được xoá lây kết nối TikTok (dữ liệu vận hành phải giữ nguyên).
CREATE INDEX "pod_tiktok_accounts_seller_id_idx" ON "pod_tiktok_accounts"("seller_id");
ALTER TABLE "pod_tiktok_accounts"
  ADD CONSTRAINT "pod_tiktok_accounts_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
