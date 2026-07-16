// ============================================================================
// NCMedia Management Platform — Database Seed (Sprint 1: Auth + RBAC)
// Chạy: `npx prisma db seed` (cấu hình package.json: "prisma": { "seed": "ts-node prisma/seed.ts" })
// Yêu cầu dev-dependency: ts-node, và dependency: bcrypt (+ @types/bcrypt).
//
// Seed tạo (idempotent qua upsert):
//   - Permission Catalog (global)
//   - Organization "Demo"
//   - Roles: ADMIN, EMPLOYEE, FULFILLMENT (is_system)
//   - RolePermission: gán TOÀN BỘ permission cho ADMIN (BR-18)
//   - Admin User (bcrypt cost 12)
//
// Không sinh Backend/API/Frontend.
// ============================================================================

import { PrismaClient, UserStatus, OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  EMPLOYEE_DEFAULT_PERMISSIONS,
  FULFILLMENT_DEFAULT_PERMISSIONS,
} from '../src/modules/auth/constants/default-roles';

const prisma = new PrismaClient();

const BCRYPT_COST = 12; // Decision-003

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
  { code: 'order.fulfill', module: 'ORDER', resource: 'order', action: 'fulfill', description: 'Cập nhật fulfillment (tracking/status/warehouse note)' },
  { code: 'order.release', module: 'ORDER', resource: 'order', action: 'release', description: 'Release Order đã claim (Admin)' },
  // Profile module (self-service)
  { code: 'profile.read',   module: 'PROFILE', resource: 'profile', action: 'read',   description: 'Xem hồ sơ của mình' },
  { code: 'profile.update', module: 'PROFILE', resource: 'profile', action: 'update', description: 'Cập nhật hồ sơ của mình' },
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
  console.log('▶ Seeding NCMedia (Auth/RBAC) ...');

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

  // 2) Organization Demo — upsert theo slug (unique)
  const org = await prisma.organization.upsert({
    where: { slug: DEMO_ORG.slug },
    update: {},
    create: {
      name: DEMO_ORG.name,
      slug: DEMO_ORG.slug,
      status: OrganizationStatus.ACTIVE,
    },
  });
  console.log(`  ✓ Organization: ${org.name} (${org.slug})`);

  // 3) Roles theo org — upsert theo (organization_id, code)
  const roleByCode: Record<string, string> = {};
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

  // 4) RolePermission — gán TOÀN BỘ permission cho MỌI Role ADMIN (BR-18) + BACKFILL.
  //    Fix bug: Role ADMIN của Organization đăng ký TRƯỚC khi catalog permission được seed
  //    (hoặc trước khi thêm permission mới như account.*) sẽ THIẾU permission → 403 ở
  //    PermissionsGuard. Backfill idempotent: cấp toàn bộ catalog cho tất cả Role code=ADMIN.
  const allPermissions = await prisma.permission.findMany({ select: { id: true } });
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
    `  ✓ RolePermission: ${allAdminRoles.length} ADMIN role(s) ← ${allPermissions.length} permissions (backfill toàn bộ Org)`,
  );

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

  // 5) Admin User — upsert theo email (global unique)
  const passwordHash = await bcrypt.hash(DEMO_ADMIN.password, BCRYPT_COST);
  const admin = await prisma.user.upsert({
    where: { email: DEMO_ADMIN.email },
    update: {},
    create: {
      organizationId: org.id,
      roleId: roleByCode['ADMIN'],
      email: DEMO_ADMIN.email,
      passwordHash,
      fullName: DEMO_ADMIN.fullName,
      status: UserStatus.ACTIVE,
    },
  });
  console.log(`  ✓ Admin User: ${admin.email}`);

  console.log('✅ Seed hoàn tất.');
}

main()
  .catch((e) => {
    console.error('❌ Seed thất bại:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
