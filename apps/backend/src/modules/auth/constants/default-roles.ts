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

/**
 * Quyền của Role SUPER_ADMIN — và CHỈ role đó được nhận.
 *
 * 🔴 `platform.masterdata.*` nằm ở đây chứ KHÔNG nằm trong catalog của org admin: dữ liệu
 * master TikTok (danh mục / thương hiệu / thuộc tính) dùng chung cho MỌI tổ chức, nên một
 * Admin tổ chức chạy đồng bộ là ghi đè dữ liệu của tất cả những người còn lại. Tiền tố
 * `platform.` đã có sẵn hàng rào lọc ở `PermissionService` và ở seed — đặt quyền vào đúng
 * nhóm này là đủ, không cần dựng thêm cơ chế phân quyền thứ hai.
 */
export const SUPER_ADMIN_PERMISSIONS = [
  'platform.organization.read',
  'platform.organization.approve',
  'platform.masterdata.read',
  'platform.masterdata.sync',
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
 * 🔴 **CÓ `pod.product.sync`**, nhưng chỉ sau khi đường đồng bộ đã được vá.
 *
 * Trước đây quyền này bị giữ lại vì `PodProductService.triggerSync` nhận thẳng
 * `accountId`/`shopId` từ request và KHÔNG đi qua `PodAccessScopeService`: bỏ trống bộ lọc
 * là quét MỌI shop của tổ chức. Lý do loại trừ nằm ở **lỗ hổng của đường đó**, không phải ở
 * chỗ Seller không được phép đồng bộ shop của mình.
 *
 * `triggerSync` nay nhận `PodAccessScope`, chặn `accountId`/`shopId` ngoài phạm vi bằng 403,
 * và giới hạn tập shop bằng `shopIds` cho trường hợp không gửi bộ lọc. Seller bấm "Sync Now"
 * chỉ chạm đúng những shop Admin đã gán — cùng mức tin cậy đã trao ở `pod.listing.publish`
 * và `pod.flashsale.publish`. Hạn mức API vẫn được bảo vệ bởi khoá Redis theo từng shop.
 *
 * 🔴 **VẪN KHÔNG có `pod.tiktok.order.sync` / `pod.tiktok.payout.sync`**: hai đường đó chưa
 * được vá tương tự, và chưa có yêu cầu nghiệp vụ nào cần tới. Đừng thêm vào đây trước khi
 * kiểm tra chúng có nhận `PodAccessScope` hay không.
 *
 * 🔴 **CÓ `pod.tiktok.account.create`** (liên kết TikTok Shop) nhưng KHÔNG có `update` /
 * `delete`. Seller tự mang gian hàng của mình vào hệ thống — đó là việc của họ, và kết nối
 * vừa tạo được gán thẳng cho chính họ (xem `resolveOwningSeller`). Nhưng gỡ liên kết, đổi
 * người phụ trách hay đổi kho mặc định thì vẫn là quyết định của Admin: chúng ảnh hưởng tới
 * dữ liệu người khác đang dùng.
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
  // TikTok Accounts: xem + TỰ LIÊN KẾT gian hàng của mình. Không unlink, không sửa.
  'pod.tiktok.account.read',
  'pod.tiktok.account.create',
  // Products: xem + tìm kiếm + ĐỒNG BỘ shop được gán. Không sửa, không xoá.
  // 🔴 `pod.product.sync` chỉ an toàn vì `triggerSync` đã đi qua `PodAccessScopeService`.
  'pod.product.read',
  'pod.product.sync',
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
  // Flash Sale: Seller tự chạy khuyến mãi cho shop được gán — cùng mức tin cậy đã trao ở
  // `pod.listing.publish` (đưa hàng lên sàn). Phạm vi vẫn bị `PodAccessScopeService` chặn
  // ở đúng những shop Admin đã gán, nên đây KHÔNG phải quyền xuyên shop.
  'pod.flashsale.read',
  'pod.flashsale.write',
  'pod.flashsale.publish',
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
