/* eslint-disable */
/**
 * Kiểm thử API Dashboard qua HTTP THẬT (guard, route, validate thật).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-dashboard-api.manual.ts
 * Cần backend đang chạy ở :3000. Chỉ ĐỌC dữ liệu (một Seller tạm được tạo và dọn ở cuối).
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3000/api/v1';
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}

async function main() {
  const prisma = new PrismaClient();
  const orgRow = await prisma.podOrder.findFirstOrThrow({ select: { organizationId: true } });
  const orgId = orgRow.organizationId;
  const admin = await prisma.user.findFirstOrThrow({
    where: { organizationId: orgId, role: { code: 'ADMIN' }, deletedAt: null, status: 'ACTIVE' },
  });
  const employeeRole = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, code: 'EMPLOYEE' } });
  const seller = await prisma.user.create({
    data: {
      organizationId: orgId,
      roleId: employeeRole.id,
      email: `dash-seller-${Date.now()}@e2e-test.local`,
      fullName: 'Dash Seller',
      passwordHash: 'x',
      status: 'ACTIVE',
    },
  });
  const sign = (userId: string, role: string) =>
    jwt.sign({ sub: userId, organizationId: orgId, role, jti: randomUUID() }, process.env.JWT_ACCESS_SECRET as string, {
      algorithm: 'HS256',
      expiresIn: 900,
    });
  const get = async (token: string, path: string) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const tAdmin = sign(admin.id, 'ADMIN');
  const tSeller = sign(seller.id, 'EMPLOYEE');

  try {
    console.log('\n▶ Admin');
    for (const path of ['/pod/dashboard/filters', '/pod/dashboard/overview', '/pod/dashboard/summary', '/pod/dashboard/sellers', '/pod/dashboard/trends']) {
      const started = Date.now();
      const res = await get(tAdmin, path);
      check(`GET ${path} ⇒ 200 (${Date.now() - started}ms)`, res.status === 200 && res.body?.success === true, res.body);
    }
    const trends = await get(tAdmin, '/pod/dashboard/trends?from=2026-09-01&to=2026-09-30');
    check('trends 01/09–30/09 ⇒ đủ 30 ngày', trends.body?.data?.finance?.length === 30 && trends.body?.data?.orders?.length === 30);
    const sorted = await get(tAdmin, '/pod/dashboard/sellers?from=2025-10-01&to=2026-09-30&sort=hold&order=desc&page=1&limit=10&activeOnly=true');
    check('sellers: sort / page / activeOnly hợp lệ ⇒ 200', sorted.status === 200, sorted.body);

    console.log('\n▶ Validate');
    const reversed = await get(tAdmin, '/pod/dashboard/summary?from=2026-09-30&to=2026-09-01');
    check('ngày bắt đầu sau ngày kết thúc ⇒ 400 DASHBOARD_RANGE_INVALID', reversed.status === 400 && reversed.body?.code === 'DASHBOARD_RANGE_INVALID', reversed.body);
    const tooLong = await get(tAdmin, '/pod/dashboard/trends?from=2024-01-01&to=2026-01-01');
    check('khoảng > 366 ngày ⇒ 400', tooLong.status === 400, tooLong.body);
    const badSort = await get(tAdmin, '/pod/dashboard/sellers?sort=password_hash');
    check('cột sắp xếp ngoài whitelist ⇒ 400', badSort.status === 400, badSort.body);
    const badCurrency = await get(tAdmin, "/pod/dashboard/overview?currency=US'D");
    check('currency sai định dạng ⇒ 400', badCurrency.status === 400, badCurrency.body);

    console.log('\n▶ Seller (không có report.read)');
    for (const path of ['/pod/dashboard/overview', '/pod/dashboard/sellers', '/pod/dashboard/filters']) {
      const res = await get(tSeller, path);
      check(`GET ${path} ⇒ 403`, res.status === 403, res.status);
    }
  } finally {
    await prisma.user.delete({ where: { id: seller.id } });
    console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }
}

void main();
