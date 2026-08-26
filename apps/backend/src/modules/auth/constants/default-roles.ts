/**
 * Role mặc định seed khi tạo Organization (ADR-009, auth.md BR-17).
 * code viết HOA, nhất quán với prisma/seed.ts.
 */
export const DEFAULT_ROLES = [
  { code: 'ADMIN', displayName: 'Administrator', description: 'Toàn quyền trong Organization' },
  { code: 'EMPLOYEE', displayName: 'Employee', description: 'Nhân viên — quyền theo phân công' },
  { code: 'FULFILLMENT', displayName: 'Fulfillment', description: 'Xử lý fulfillment cho Order được gán' },
] as const;

export const ADMIN_ROLE_CODE = 'ADMIN';
export const EMPLOYEE_ROLE_CODE = 'EMPLOYEE';
export const FULFILLMENT_ROLE_CODE = 'FULFILLMENT';

/**
 * Role của Super Admin — quản trị NỀN TẢNG, không phải quản trị một Organization.
 *
 * 🔴 Role này CHỈ tồn tại trong Organization hệ thống (`is_platform = true`) và KHÔNG nằm
 * trong `DEFAULT_ROLES`: mỗi Organization mới không được phép có sẵn một role mang quyền
 * duyệt Organization của người khác.
 */
export const SUPER_ADMIN_ROLE_CODE = 'SUPER_ADMIN';

/**
 * Tiền tố của nhóm quyền QUẢN TRỊ NỀN TẢNG (duyệt/từ chối Organization).
 *
 * 🔴 Đây là hàng rào chống leo thang đặc quyền xuyên tenant. Register và seed đều gán "toàn
 * bộ catalog" cho role ADMIN của mỗi Organization (BR-18); nếu quyền `platform.*` nằm trong
 * catalog đó thì **mọi org admin đều duyệt được Organization của người khác**. Vì thế mọi nơi
 * cấp quyền hàng loạt phải lọc bằng tiền tố này.
 */
export const PLATFORM_PERMISSION_PREFIX = 'platform.';

/** Quyền của Role SUPER_ADMIN — và CHỈ role đó được nhận. */
export const SUPER_ADMIN_PERMISSIONS = [
  'platform.organization.read',
  'platform.organization.approve',
] as const;

/**
 * Permission mặc định của Role EMPLOYEE (Seller) khi tạo Organization.
 *
 * Gồm: quản lý Account của mình, Order nội bộ, Profile self-service, và **bộ quyền POD của
 * Seller**. ADMIN nhận toàn bộ catalog. Nguồn dùng chung cho register.service & prisma/seed.ts.
 *
 * 🔴 **KHÔNG có `pod.shop.all`.** Đây là điều khiến Seller chỉ thấy shop được Admin gán —
 * xem `PodAccessScopeService`. Thêm quyền đó vào đây là gỡ bỏ toàn bộ hàng rào phân quyền
 * theo shop, không phải "mở rộng một chút".
 *
 * 🔴 **KHÔNG có `fulfillment.*`.** Gửi đơn sang xưởng in là hành động tiêu tiền và không thể
 * hoàn tác; Seller chuẩn bị dữ liệu (design, ánh xạ), Admin mới là người bấm gửi.
 *
 * 🔴 **KHÔNG có `*.sync`** (`pod.tiktok.order.sync`, `pod.product.sync`,
 * `pod.tiktok.payout.sync`, `pod.tiktok.account.*`): đồng bộ và liên kết tài khoản là thao
 * tác cấp tổ chức, chạm vào hạn mức API của cả tổ chức chứ không riêng shop của một người.
 */
export const EMPLOYEE_DEFAULT_PERMISSIONS = [
  'account.read',
  'account.update',
  'order.read',
  'order.create',
  'order.update',
  'order.delete',
  'order.note',
  'profile.read',
  'profile.update',

  // --- POD: chỉ trên shop được Admin gán (xem PodAccessScopeService) ---
  // TikTok Accounts: CHỈ xem, không link/unlink/sửa/sync.
  'pod.tiktok.account.read',
  // Products: chỉ xem + tìm kiếm; không sync, không sửa, không xoá.
  'pod.product.read',
  // Template: thuộc Organization, KHÔNG theo shop ⇒ toàn quyền.
  'pod.template.read',
  'pod.template.write',
  // Auto Listing + Draft Listings.
  'pod.session.read',
  'pod.session.write',
  'pod.session.import',
  'pod.draft.read',
  'pod.draft.generate',
  // Publish History (read) + đẩy hàng lên sàn.
  'pod.listing.read',
  'pod.listing.publish',
  // POD Orders + Design (công việc của Designer).
  'pod.tiktok.order.read',
  'pod.tiktok.design.upload',
  'pod.tiktok.design.delete',
  // Payout: chỉ xem báo cáo của shop mình.
  'pod.tiktok.payout.read',
  // Ánh xạ sản phẩm (API nằm ở module Fulfillment).
  // 🔴 `fulfillment.mapping` chứ KHÔNG phải `fulfillment.config`: quyền config còn cho
  // thêm/xoá Fulfillment Provider và đổi API key của cả tổ chức.
  // Cũng KHÔNG kéo theo quyền gửi đơn — `fulfillment.create/cancel` là hai quyền riêng.
  'fulfillment.mapping',
  'fulfillment.read',
  // Design nằm trên Storage Module.
  'storage.read',
  'storage.upload',
] as const;

/**
 * Permission mặc định của Role FULFILLMENT:
 * xem TẤT CẢ Order (order.read + scope role-based), Nhận xử lý (claim) và cập nhật
 * fulfillment (tracking/status theo Item) trên đơn mình đã claim + quản lý ghi chú kho
 * (order.note). KHÔNG order.create/update/delete (không sửa thông tin bán hàng). Profile self-service.
 */
export const FULFILLMENT_DEFAULT_PERMISSIONS = [
  'order.read',
  'order.claim',
  'order.fulfill',
  'order.note',
  'profile.read',
  'profile.update',
] as const;
