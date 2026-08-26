// ============================================================================
// NCMedia Management Platform — Database Seed (Sprint 1: Auth + RBAC)
// Chạy: `npx prisma db seed` (cấu hình package.json: "prisma": { "seed": "ts-node prisma/seed.ts" })
// Yêu cầu dev-dependency: ts-node, và dependency: bcrypt (+ @types/bcrypt).
//
// Seed tạo (idempotent qua upsert):
//   - Permission Catalog (global)
//   - Organization "Demo"
//   - Roles: ADMIN, EMPLOYEE, FULFILLMENT (is_system)
//   - RolePermission: gán TOÀN BỘ permission cho ADMIN (BR-18) — TRỪ nhóm platform.*
//   - Admin User (bcrypt cost 12)
//   - Organization HỆ THỐNG (is_platform) + Role SUPER_ADMIN + Super Admin (từ ENV)
//
// Không sinh Backend/API/Frontend.
// ============================================================================

import { PrismaClient, UserStatus, OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  EMPLOYEE_DEFAULT_PERMISSIONS,
  FULFILLMENT_DEFAULT_PERMISSIONS,
  PLATFORM_PERMISSION_PREFIX,
  SUPER_ADMIN_PERMISSIONS,
  SUPER_ADMIN_ROLE_CODE,
} from '../src/modules/auth/constants/default-roles';

const prisma = new PrismaClient();

const BCRYPT_COST = 12; // Decision-003

/**
 * Organization HỆ THỐNG — nơi chứa tài khoản Super Admin.
 *
 * 🔴 Không phải một tenant nghiệp vụ: `is_platform = true` khiến nó bị loại khỏi mọi danh
 * sách và thống kê Organization. Nó tồn tại để Super Admin vẫn là một `User` bình thường
 * thuộc đúng một Organization (ADR-008) — nhờ đó Authentication/JWT/RBAC dùng lại nguyên vẹn,
 * không sinh ra luồng đăng nhập thứ hai.
 */
const PLATFORM_ORG = { name: 'NCMedia Platform', slug: 'platform' };

/**
 * Super Admin đầu tiên — đọc từ ENV, KHÔNG hardcode mật khẩu.
 *
 * Thiếu ENV thì seed BỎ QUA (kèm cảnh báo) thay vì tạo một tài khoản quyền cao nhất hệ thống
 * với mật khẩu ai cũng đoán được.
 */
const SUPER_ADMIN = {
  email: (process.env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase(),
  password: process.env.SUPER_ADMIN_PASSWORD ?? '',
  fullName: process.env.SUPER_ADMIN_FULL_NAME ?? 'Super Administrator',
};

// --- Cấu hình Organization Demo & Admin (chỉ dùng cho seed dev) ---
const DEMO_ORG = { name: 'Demo Organization', slug: 'demo' };
const DEMO_ADMIN = {
  email: 'admin@demo.ncmedia.local',
  fullName: 'Demo Admin',
  // Mật khẩu mặc định cho môi trường dev — đạt policy ≥8, có chữ + số (Decision-002).
  // PHẢI đổi ngay sau lần đăng nhập đầu tiên.
  password: 'ChangeMe123',
};

// --- Permission Catalog (global). module lưu tường minh, không parse từ resource (PO #4) ---
const PERMISSIONS: Array<{
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
}> = [
  { code: 'organization.read', module: 'AUTH', resource: 'organization', action: 'read', description: 'Xem thông tin Organization' },
  { code: 'role.read',        module: 'AUTH', resource: 'role',       action: 'read',   description: 'Xem Role' },
  { code: 'role.create',      module: 'AUTH', resource: 'role',       action: 'create', description: 'Tạo Role' },
  { code: 'role.update',      module: 'AUTH', resource: 'role',       action: 'update', description: 'Cập nhật Role' },
  { code: 'role.delete',      module: 'AUTH', resource: 'role',       action: 'delete', description: 'Xóa Role' },
  { code: 'permission.read',  module: 'AUTH', resource: 'permission', action: 'read',   description: 'Xem Permission catalog' },
  { code: 'user.read',        module: 'AUTH', resource: 'user',       action: 'read',   description: 'Xem User' },
  { code: 'user.create',      module: 'AUTH', resource: 'user',       action: 'create', description: 'Tạo User' },
  { code: 'user.update',      module: 'AUTH', resource: 'user',       action: 'update', description: 'Cập nhật User' },
  { code: 'user.delete',      module: 'AUTH', resource: 'user',       action: 'delete', description: 'Xóa User' },
  // Account module (docs/account.md)
  { code: 'account.read',               module: 'ACCOUNT', resource: 'account',            action: 'read',   description: 'Xem Account' },
  { code: 'account.create',             module: 'ACCOUNT', resource: 'account',            action: 'create', description: 'Tạo Account' },
  { code: 'account.update',             module: 'ACCOUNT', resource: 'account',            action: 'update', description: 'Cập nhật Account' },
  { code: 'account.delete',             module: 'ACCOUNT', resource: 'account',            action: 'delete', description: 'Xóa Account' },
  { code: 'account.assign',             module: 'ACCOUNT', resource: 'account',            action: 'assign', description: 'Gán Seller cho Account' },
  { code: 'account.credentials.read',   module: 'ACCOUNT', resource: 'account.credentials', action: 'read',   description: 'Xem (reveal) credentials Account' },
  { code: 'account.credentials.update', module: 'ACCOUNT', resource: 'account.credentials', action: 'update', description: 'Cập nhật credentials Account' },
  { code: 'account.export',             module: 'ACCOUNT', resource: 'account',            action: 'export', description: 'Export Account ra Excel (Admin)' },
  { code: 'account.import',             module: 'ACCOUNT', resource: 'account',            action: 'import', description: 'Import Account từ Excel (Admin)' },
  // Employee module (menu "Nhân viên" gate bằng employee.read)
  { code: 'employee.read',   module: 'EMPLOYEE', resource: 'employee', action: 'read',   description: 'Xem Employee' },
  { code: 'employee.create', module: 'EMPLOYEE', resource: 'employee', action: 'create', description: 'Tạo Employee' },
  { code: 'employee.update', module: 'EMPLOYEE', resource: 'employee', action: 'update', description: 'Cập nhật Employee' },
  { code: 'employee.delete', module: 'EMPLOYEE', resource: 'employee', action: 'delete', description: 'Xóa Employee' },
  // Order module (permission phục vụ RBAC/sidebar — module Order triển khai sau)
  { code: 'order.read',    module: 'ORDER', resource: 'order', action: 'read',    description: 'Xem Order' },
  { code: 'order.create',  module: 'ORDER', resource: 'order', action: 'create',  description: 'Tạo Order' },
  { code: 'order.update',  module: 'ORDER', resource: 'order', action: 'update',  description: 'Cập nhật Order' },
  { code: 'order.delete',  module: 'ORDER', resource: 'order', action: 'delete',  description: 'Xóa Order' },
  { code: 'order.claim',   module: 'ORDER', resource: 'order', action: 'claim',   description: 'Nhận xử lý (claim) Order — Fulfillment' },
  { code: 'order.fulfill', module: 'ORDER', resource: 'order', action: 'fulfill', description: 'Cập nhật fulfillment (tracking/status theo Item)' },
  { code: 'order.note',    module: 'ORDER', resource: 'order', action: 'note',    description: 'Quản lý ghi chú đơn (Seller/Warehouse)' },
  { code: 'order.release', module: 'ORDER', resource: 'order', action: 'release', description: 'Release Order đã claim (Admin)' },
  // Profile module (self-service)
  { code: 'profile.read',   module: 'PROFILE', resource: 'profile', action: 'read',   description: 'Xem hồ sơ của mình' },
  { code: 'profile.update', module: 'PROFILE', resource: 'profile', action: 'update', description: 'Cập nhật hồ sơ của mình' },
  // Report module (Dashboard + Reports — thống kê tổng hợp toàn Organization)
  { code: 'report.read',    module: 'REPORT', resource: 'report', action: 'read', description: 'Xem Báo cáo & Dashboard thống kê' },
  // Module POD — TikTok Shop (docs/pod-tiktok/**). Sprint 1: Link Account.
  // 🔴 Quyền XUYÊN SHOP. Không có nó ⇒ chỉ thấy shop mà Admin đã gán (PodAccessScopeService).
  // Dùng permission thay vì so mã role vì role là động (ADR-009): tổ chức có thể tạo thêm
  // role cần thấy mọi shop mà không phải sửa code.
  { code: 'pod.shop.all',              module: 'POD_TIKTOK', resource: 'pod.shop',          action: 'all',    description: 'Xem dữ liệu POD của MỌI shop trong tổ chức (bỏ giới hạn theo shop được gán)' },
  { code: 'pod.tiktok.account.read',   module: 'POD_TIKTOK', resource: 'pod.tiktok.account', action: 'read',   description: 'Xem TikTok Shop Account đã liên kết' },
  { code: 'pod.tiktok.account.create', module: 'POD_TIKTOK', resource: 'pod.tiktok.account', action: 'create', description: 'Liên kết (link) TikTok Shop Account' },
  { code: 'pod.tiktok.account.update', module: 'POD_TIKTOK', resource: 'pod.tiktok.account', action: 'update', description: 'Cập nhật kết nối TikTok Shop (refresh token, bật/tắt sync)' },
  { code: 'pod.tiktok.account.delete', module: 'POD_TIKTOK', resource: 'pod.tiktok.account', action: 'delete', description: 'Ngắt liên kết (unlink) TikTok Shop Account' },
  // Sprint 2: Scheduler + Get Orders + Sync Orders
  { code: 'pod.tiktok.order.read',     module: 'POD_TIKTOK', resource: 'pod.tiktok.order',   action: 'read',   description: 'Xem đơn TikTok đã đồng bộ + nhật ký đồng bộ' },
  { code: 'pod.tiktok.order.sync',     module: 'POD_TIKTOK', resource: 'pod.tiktok.order',   action: 'sync',   description: 'Kích hoạt đồng bộ đơn TikTok thủ công' },
  // Sprint Order List Enhancement: upload design cho tung san pham
  { code: 'pod.tiktok.design.upload',  module: 'POD_TIKTOK', resource: 'pod.tiktok.design',  action: 'upload', description: 'Upload/thay thế design in cho sản phẩm POD' },
  { code: 'pod.tiktok.design.delete',  module: 'POD_TIKTOK', resource: 'pod.tiktok.design',  action: 'delete', description: 'Xoá design in của sản phẩm POD' },
  // Sprint Payout Report: thong ke chi tra tu TikTok Finance API
  { code: 'pod.product.read',          module: 'POD_TIKTOK', resource: 'pod.product',       action: 'read',   description: 'Xem san pham TikTok da dong bo' },
  { code: 'pod.product.sync',          module: 'POD_TIKTOK', resource: 'pod.product',       action: 'sync',   description: 'Dong bo san pham tu TikTok Shop' },

  { code: 'pod.template.read',         module: 'POD_TIKTOK', resource: 'pod.template',      action: 'read',   description: 'Xem Listing Template va cac template thanh phan' },
  { code: 'pod.template.write',        module: 'POD_TIKTOK', resource: 'pod.template',      action: 'write',  description: 'Tao/sua/xoa Listing Template va cac template thanh phan' },
  { code: 'pod.draft.read',            module: 'POD_TIKTOK', resource: 'pod.draft',         action: 'read',   description: 'Xem Draft Listing va preview listing' },
  { code: 'pod.draft.generate',        module: 'POD_TIKTOK', resource: 'pod.draft',         action: 'generate', description: 'Sinh Draft Listing tu Product + Template' },
  // Sprint Listing Session: mot luot dang hang (Market + Shops + Template + Import)
  { code: 'pod.session.read',         module: 'POD_TIKTOK', resource: 'pod.session',       action: 'read',   description: 'Xem Listing Session, Draft Product va preview' },
  { code: 'pod.session.write',        module: 'POD_TIKTOK', resource: 'pod.session',       action: 'write',  description: 'Tao/sua/xoa Listing Session va Draft Product ben trong' },
  { code: 'pod.session.import',       module: 'POD_TIKTOK', resource: 'pod.session',       action: 'import', description: 'Import Draft Product vao Listing Session tu file Excel/CSV' },
  // Sprint Bulk Listing Engine: day hang loat len TikTok duoi dang Draft Product
  { code: 'pod.listing.read',          module: 'POD_TIKTOK', resource: 'pod.listing',       action: 'read',   description: 'Xem Listing Job, tien do, log va Publish History' },
  { code: 'pod.listing.run',           module: 'POD_TIKTOK', resource: 'pod.listing',       action: 'run',    description: 'Chay Bulk Listing (tao Draft Product tren TikTok), retry, huy, xoa job' },
  // Sprint Publish: dua Draft da co tren TikTok vao hang cho duyet (save_mode = LISTING).
  // Tach khoi pod.listing.run vi day la hanh dong DUA HANG LEN SAN — khong the gop chung
  // quyen voi viec tao Draft (von khong anh huong gi toi shop that).
  { code: 'pod.listing.publish',       module: 'POD_TIKTOK', resource: 'pod.listing',       action: 'publish', description: 'Publish Draft len TikTok (gui duyet), retry publish va dong bo trang thai duyet' },

  { code: 'pod.tiktok.payout.read',    module: 'POD_TIKTOK', resource: 'pod.tiktok.payout',  action: 'read',   description: 'Xem báo cáo Payout TikTok' },
  { code: 'pod.tiktok.payout.sync',    module: 'POD_TIKTOK', resource: 'pod.tiktok.payout',  action: 'sync',   description: 'Đồng bộ dữ liệu Payout từ TikTok Finance API' },
  // Module Fulfillment — gui don sang xuong in (MangoTeePrints)
  { code: 'fulfillment.read',   module: 'FULFILLMENT', resource: 'fulfillment', action: 'read',   description: 'Xem trạng thái, lịch sử và lỗi fulfillment' },
  { code: 'fulfillment.create', module: 'FULFILLMENT', resource: 'fulfillment', action: 'create', description: 'Gửi đơn sang xưởng in (Fulfill / Retry)' },
  { code: 'fulfillment.cancel', module: 'FULFILLMENT', resource: 'fulfillment', action: 'cancel', description: 'Huỷ đơn tại xưởng in' },
  { code: 'fulfillment.config', module: 'FULFILLMENT', resource: 'fulfillment', action: 'config', description: 'Quản lý Fulfillment Provider (thêm/sửa/xoá/bật-tắt/test kết nối) và đồng bộ danh mục' },
  // 🔴 TÁCH khỏi `fulfillment.config`. Ánh xạ sản phẩm là việc của Seller/Designer; cấu hình
  // nhà cung cấp là việc của Admin. Gộp chung nghĩa là muốn cho Seller ánh xạ thì phải cho
  // luôn quyền thêm/xoá Fulfillment Provider và đổi API key của cả tổ chức.
  { code: 'fulfillment.mapping', module: 'FULFILLMENT', resource: 'fulfillment', action: 'mapping', description: 'Khai ánh xạ sản phẩm TikTok ⇄ SKU nhà cung cấp (đọc danh mục đã đồng bộ)' },
  // Storage Module (core) — API lưu trữ file dùng chung cho mọi module
  { code: 'storage.read',   module: 'STORAGE', resource: 'storage', action: 'read',   description: 'Xem/tải file trong kho lưu trữ' },
  { code: 'storage.upload', module: 'STORAGE', resource: 'storage', action: 'upload', description: 'Tải file lên kho lưu trữ' },
  { code: 'storage.delete', module: 'STORAGE', resource: 'storage', action: 'delete', description: 'Xoá file khỏi kho lưu trữ' },
  // ---------------------------------------------------------------------------
  // Quản trị NỀN TẢNG (Super Admin) — duyệt đăng ký Organization.
  //
  // 🔴 Nhóm `platform.*` KHÔNG BAO GIỜ được cấp cho Role ADMIN của một Organization. Xem
  // hàng rào ở `PermissionService.findAllIdsInTransaction` (đường Register) và ở bước 4
  // của seed (đường backfill). Bỏ hàng rào đó là mọi org admin đều duyệt được hồ sơ của
  // tổ chức khác.
  // ---------------------------------------------------------------------------
  { code: 'platform.organization.read',    module: 'PLATFORM', resource: 'platform.organization', action: 'read',    description: 'Super Admin: xem danh sách + chi tiết Organization đã đăng ký' },
  { code: 'platform.organization.approve', module: 'PLATFORM', resource: 'platform.organization', action: 'approve', description: 'Super Admin: duyệt / từ chối Organization đăng ký mới' },
];

/** Permission mặc định cho Role EMPLOYEE — dùng chung với register.service (default-roles.ts). */
const EMPLOYEE_PERMISSION_CODES = [...EMPLOYEE_DEFAULT_PERMISSIONS];
/** Permission mặc định cho Role FULFILLMENT. */
const FULFILLMENT_PERMISSION_CODES = [...FULFILLMENT_DEFAULT_PERMISSIONS];

// --- Platform Catalog (Global — ADR-011) ---
const PLATFORMS: Array<{ code: string; name: string }> = [
  { code: 'TIKTOK_SHOP', name: 'TikTok Shop' },
  { code: 'EBAY', name: 'eBay' },
  { code: 'AMAZON', name: 'Amazon' },
  { code: 'ETSY', name: 'Etsy' },
  { code: 'SHOPIFY', name: 'Shopify' },
  { code: 'MERCARI', name: 'Mercari' },
  { code: 'WALMART', name: 'Walmart' },
];

// --- Roles mặc định (is_system = true, không được xóa — BR-17) ---
const ROLES: Array<{ code: string; displayName: string; description: string }> = [
  { code: 'ADMIN',       displayName: 'Administrator',   description: 'Toàn quyền trong Organization' },
  { code: 'EMPLOYEE',    displayName: 'Employee',        description: 'Nhân viên — quyền hạn theo phân công' },
  { code: 'FULFILLMENT', displayName: 'Fulfillment',     description: 'Xử lý fulfillment cho Order được gán' },
];

async function main() {
  // Catalog (permission + platform) + backfill role_permissions: LUÔN chạy (idempotent, cần cho mọi env).
  // Demo Organization + Admin demo (admin@demo.ncmedia.local): chỉ tạo khi KHÔNG tắt tường minh.
  // Production đặt SEED_DEMO=false → KHÔNG tạo tài khoản demo mật khẩu mặc định.
  const seedDemo = process.env.SEED_DEMO !== 'false';
  console.log(`▶ Seeding NCMedia (Auth/RBAC) ... [demo=${seedDemo}]`);

  // 1) Permission Catalog (global) — upsert theo code
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, resource: p.resource, action: p.action, description: p.description },
      create: p,
    });
  }
  console.log(`  ✓ Permissions: ${PERMISSIONS.length}`);

  // 1b) Platform Catalog (global) — upsert theo code
  for (const p of PLATFORMS) {
    await prisma.platform.upsert({
      where: { code: p.code },
      update: { name: p.name, isActive: true },
      create: { code: p.code, name: p.name, isActive: true },
    });
  }
  console.log(`  ✓ Platforms: ${PLATFORMS.length}`);

  // 2+3) Demo Organization + Roles — CHỈ khi seedDemo (dev). Production bỏ qua.
  let demoOrgId: string | null = null;
  const roleByCode: Record<string, string> = {};
  if (seedDemo) {
    const org = await prisma.organization.upsert({
      where: { slug: DEMO_ORG.slug },
      update: {},
      create: {
        name: DEMO_ORG.name,
        slug: DEMO_ORG.slug,
        status: OrganizationStatus.ACTIVE,
      },
    });
    demoOrgId = org.id;
    console.log(`  ✓ Organization: ${org.name} (${org.slug})`);

    for (const r of ROLES) {
      const role = await prisma.role.upsert({
        where: { organizationId_code: { organizationId: org.id, code: r.code } },
        update: { displayName: r.displayName, description: r.description, isSystem: true },
        create: {
          organizationId: org.id,
          code: r.code,
          displayName: r.displayName,
          description: r.description,
          isSystem: true,
        },
      });
      roleByCode[r.code] = role.id;
    }
    console.log(`  ✓ Roles: ${ROLES.map((r) => r.code).join(', ')}`);
  }

  // 4) RolePermission — gán TOÀN BỘ permission cho MỌI Role ADMIN (BR-18) + BACKFILL.
  //    Fix bug: Role ADMIN của Organization đăng ký TRƯỚC khi catalog permission được seed
  //    (hoặc trước khi thêm permission mới như account.*) sẽ THIẾU permission → 403 ở
  //    PermissionsGuard. Backfill idempotent: cấp toàn bộ catalog cho tất cả Role code=ADMIN.
  //
  //    🔴 LOẠI TRỪ nhóm `platform.*`: đó là quyền quản trị NỀN TẢNG (duyệt Organization của
  //    người khác), chỉ Role SUPER_ADMIN được giữ. Backfill "toàn bộ catalog" mà quên lọc là
  //    cấp quyền duyệt xuyên tenant cho mọi org admin đang có trong hệ thống.
  const allPermissions = await prisma.permission.findMany({
    where: { NOT: { code: { startsWith: PLATFORM_PERMISSION_PREFIX } } },
    select: { id: true },
  });
  const allAdminRoles = await prisma.role.findMany({
    where: { code: 'ADMIN', deletedAt: null },
    select: { id: true },
  });
  for (const role of allAdminRoles) {
    for (const perm of allPermissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(
    `  ✓ RolePermission: ${allAdminRoles.length} ADMIN role(s) ← ${allPermissions.length} permissions (trừ platform.*, backfill toàn bộ Org)`,
  );

  // 4a-bis) DỌN DẸP: gỡ quyền `platform.*` khỏi mọi Role KHÔNG phải SUPER_ADMIN.
  //
  // 🔴 Bước này tồn tại vì lần seed TRƯỚC (hoặc một lần đăng ký trước khi có hàng rào) có thể
  // đã cấp nhầm. Một quyền cấp nhầm không tự biến mất khi ta sửa mã nguồn — phải đi thu hồi.
  const strayPlatformGrants = await prisma.rolePermission.deleteMany({
    where: {
      permission: { code: { startsWith: PLATFORM_PERMISSION_PREFIX } },
      role: { code: { not: SUPER_ADMIN_ROLE_CODE } },
    },
  });
  if (strayPlatformGrants.count > 0) {
    console.log(
      `  ⚠ Đã thu hồi ${strayPlatformGrants.count} quyền platform.* bị cấp nhầm cho Role không phải SUPER_ADMIN`,
    );
  }

  // 4b) EMPLOYEE role — gán subset permission (Account của mình + Order + Profile) cho MỌI Org.
  const employeePerms = await prisma.permission.findMany({
    where: { code: { in: EMPLOYEE_PERMISSION_CODES } },
    select: { id: true },
  });
  const allEmployeeRoles = await prisma.role.findMany({
    where: { code: 'EMPLOYEE', deletedAt: null },
    select: { id: true },
  });
  for (const role of allEmployeeRoles) {
    for (const perm of employeePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(
    `  ✓ RolePermission: ${allEmployeeRoles.length} EMPLOYEE role(s) ← ${employeePerms.length} permissions (${EMPLOYEE_PERMISSION_CODES.join(', ')})`,
  );

  // 4c) FULFILLMENT role — gán permission (order.read/claim/fulfill + profile) cho MỌI Org (backfill).
  const fulfillmentPerms = await prisma.permission.findMany({
    where: { code: { in: FULFILLMENT_PERMISSION_CODES } },
    select: { id: true },
  });
  const allFulfillmentRoles = await prisma.role.findMany({
    where: { code: 'FULFILLMENT', deletedAt: null },
    select: { id: true },
  });
  for (const role of allFulfillmentRoles) {
    for (const perm of fulfillmentPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(
    `  ✓ RolePermission: ${allFulfillmentRoles.length} FULFILLMENT role(s) ← ${fulfillmentPerms.length} permissions (${FULFILLMENT_PERMISSION_CODES.join(', ')})`,
  );

  // 5) Admin User demo — CHỉ khi seedDemo. Production KHÔNG tạo tài khoản mật khẩu mặc định.
  if (seedDemo && demoOrgId) {
    const passwordHash = await bcrypt.hash(DEMO_ADMIN.password, BCRYPT_COST);
    const admin = await prisma.user.upsert({
      where: { email: DEMO_ADMIN.email },
      update: {},
      create: {
        organizationId: demoOrgId,
        roleId: roleByCode['ADMIN'],
        email: DEMO_ADMIN.email,
        passwordHash,
        fullName: DEMO_ADMIN.fullName,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`  ✓ Admin User: ${admin.email}`);
  } else {
    console.log('  ⤳ Bỏ qua Demo Organization/Admin (SEED_DEMO=false) — production-safe.');
  }

  // 6) Organization HỆ THỐNG + Role SUPER_ADMIN + tài khoản Super Admin.
  await seedPlatform();

  console.log('✅ Seed hoàn tất.');
}

/**
 * Tạo Organization hệ thống, Role SUPER_ADMIN và tài khoản Super Admin đầu tiên.
 *
 * ```
 *   organizations(is_platform = true)
 *        └─ roles(SUPER_ADMIN)  ←  platform.organization.read / .approve
 *              └─ users(SUPER_ADMIN_EMAIL)
 * ```
 *
 * 🔴 Idempotent: chạy lại nhiều lần không tạo thêm bản ghi. Organization hệ thống được khoá
 * bằng unique index từng phần (`is_platform = true`) ở database, nên kể cả gọi song song
 * cũng không thể có hai cửa Super Admin.
 *
 * 🔴 Mật khẩu đọc từ ENV. Thiếu ⇒ BỎ QUA việc tạo user (vẫn tạo Organization + Role, để lần
 * seed sau chỉ cần thêm ENV là xong). Không bao giờ đặt mật khẩu mặc định cho tài khoản có
 * quyền cao nhất hệ thống.
 */
async function seedPlatform(): Promise<void> {
  const org = await prisma.organization.upsert({
    where: { slug: PLATFORM_ORG.slug },
    update: { isPlatform: true, status: OrganizationStatus.ACTIVE },
    create: {
      name: PLATFORM_ORG.name,
      slug: PLATFORM_ORG.slug,
      status: OrganizationStatus.ACTIVE,
      isPlatform: true,
    },
  });

  const role = await prisma.role.upsert({
    where: { organizationId_code: { organizationId: org.id, code: SUPER_ADMIN_ROLE_CODE } },
    update: { displayName: 'Super Administrator', isSystem: true },
    create: {
      organizationId: org.id,
      code: SUPER_ADMIN_ROLE_CODE,
      displayName: 'Super Administrator',
      description: 'Quản trị nền tảng — duyệt/từ chối Organization đăng ký mới',
      isSystem: true,
    },
  });

  const platformPerms = await prisma.permission.findMany({
    where: { code: { in: [...SUPER_ADMIN_PERMISSIONS] } },
    select: { id: true },
  });
  for (const perm of platformPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  console.log(
    `  ✓ Platform Organization "${org.slug}" + Role ${SUPER_ADMIN_ROLE_CODE} ← ${platformPerms.length} permissions`,
  );

  if (!SUPER_ADMIN.email || !SUPER_ADMIN.password) {
    console.log(
      '  ⚠ Chưa tạo Super Admin: thiếu SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD trong .env',
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: SUPER_ADMIN.email } });
  if (existing) {
    // Đã có: KHÔNG ghi đè mật khẩu (seed chạy lại không được phép reset mật khẩu đang dùng),
    // chỉ bảo đảm user nằm đúng Organization hệ thống và đúng Role.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        organizationId: org.id,
        roleId: role.id,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`  ✓ Super Admin: ${existing.email} (đã tồn tại — giữ nguyên mật khẩu)`);
    return;
  }

  const passwordHash = await bcrypt.hash(SUPER_ADMIN.password, BCRYPT_COST);
  const superAdmin = await prisma.user.create({
    data: {
      organizationId: org.id,
      roleId: role.id,
      email: SUPER_ADMIN.email,
      passwordHash,
      fullName: SUPER_ADMIN.fullName,
      status: UserStatus.ACTIVE,
    },
  });
  console.log(`  ✓ Super Admin: ${superAdmin.email}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed thất bại:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
