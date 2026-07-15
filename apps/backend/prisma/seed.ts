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

  // 4) RolePermission — gán TOÀN BỘ permission cho ADMIN (BR-18)
  const allPermissions = await prisma.permission.findMany({ select: { id: true } });
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: roleByCode['ADMIN'], permissionId: perm.id } },
      update: {},
      create: { roleId: roleByCode['ADMIN'], permissionId: perm.id },
    });
  }
  console.log(`  ✓ RolePermission: ADMIN ← ${allPermissions.length} permissions`);
  // EMPLOYEE & FULFILLMENT: chưa gán quyền ở Sprint 1 (quyền nghiệp vụ bổ sung ở sprint sau).

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
