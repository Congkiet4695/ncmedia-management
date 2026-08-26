/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI luồng duyệt đăng ký Organization, chạy trên DATABASE THẬT.
 *
 * Chạy:  node -r ts-node/register test/manual/e2e-approval.manual.ts
 *
 * Đi đúng đường của người dùng: HTTP → Nest → Prisma → PostgreSQL. Không mock gì cả — đây là
 * thứ duy nhất chứng minh được rằng luồng duyệt hoạt động thật, chứ không chỉ đúng trong
 * các unit test đã mock sẵn mọi biên.
 *
 * Đặt ngoài `jest` vì nó cần database + Redis đang chạy và tự ghi/dọn dữ liệu thật.
 * Tự dọn toàn bộ dữ liệu test ở cuối.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { RateLimitService } from '../../src/modules/auth/services/rate-limit.service';

const prisma = new PrismaClient();
const stamp = Date.now();
const OWNER = `owner.${stamp}@acme-test.com`;
const OWNER2 = `owner2.${stamp}@acme-test.com`;
const PASSWORD = 'P@ssw0rd123';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api/v1');
  // Filter + Interceptor đã đăng ký toàn cục trong AppModule (APP_FILTER/APP_INTERCEPTOR);
  // chỉ cần khớp ValidationPipe của main.ts.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  const http = app.getHttpServer();
  const api = (p: string) => `/api/v1${p}`;

  // Rate limit đăng nhập là 5 request/phút/IP (Decision-005) — đúng và cần giữ. Kịch bản này
  // gọi login nhiều lần từ cùng một IP nên phải xoá bộ đếm giữa các bước, nếu không ta đang
  // kiểm thử chính cái rate limit chứ không phải luồng duyệt.
  const rateLimit = app.get(RateLimitService);
  const resetLoginLimit = () =>
    Promise.all(
      ['::ffff:127.0.0.1', '127.0.0.1', '::1'].map((ip) => rateLimit.reset(`login_rl:${ip}`)),
    ).catch(() => undefined);

  console.log('\n▶ 1. Register Organization');
  const reg = await request(http).post(api('/auth/register')).send({
    organizationName: `Acme Test ${stamp}`,
    fullName: 'Owner Acme',
    email: OWNER,
    phone: '0912345678',
    password: PASSWORD,
  });
  check('POST /auth/register → 201', reg.status === 201, reg.body);
  check('Organization = PENDING', reg.body?.data?.organization?.status === 'PENDING', reg.body?.data);
  check('Admin User = PENDING', reg.body?.data?.user?.status === 'PENDING');
  check('🔴 KHÔNG trả tokens', reg.body?.data?.tokens === undefined, Object.keys(reg.body?.data ?? {}));
  const orgId = reg.body?.data?.organization?.id as string;

  const dbUser = await prisma.user.findUnique({ where: { email: OWNER }, select: { phone: true } });
  check('Phone (tuỳ chọn) được lưu', dbUser?.phone === '0912345678', dbUser);

  console.log('\n▶ 2. Login bị chặn khi PENDING');
  const blocked = await request(http).post(api('/auth/login')).send({ email: OWNER, password: PASSWORD });
  check('POST /auth/login → 403', blocked.status === 403, blocked.body);
  check('code = AUTH_ORGANIZATION_PENDING', blocked.body?.code === 'AUTH_ORGANIZATION_PENDING', blocked.body);
  check(
    'thông điệp đúng §4',
    String(blocked.body?.message ?? '').includes('waiting for approval'),
    blocked.body?.message,
  );

  console.log('\n▶ 3. Super Admin đăng nhập');
  const sa = await request(http)
    .post(api('/auth/login'))
    .send({ email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD });
  check('Super Admin login → 200', sa.status === 200, sa.body);
  const saToken = sa.body?.data?.tokens?.accessToken as string;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${saToken}`);

  console.log('\n▶ 4. Danh sách + Dashboard');
  const list = await auth(request(http).get(api('/super-admin/organizations?status=PENDING&limit=100')));
  check('GET /super-admin/organizations → 200', list.status === 200, list.body);
  const found = (list.body?.data?.items ?? []).find((o: any) => o.id === orgId);
  check('Org PENDING có trong danh sách', Boolean(found), list.body?.data?.meta);
  check('Có Owner + email + phone (§6/§7)', found?.owner?.email === OWNER && found?.owner?.phone === '0912345678', found?.owner);
  check(
    '🔴 Organization hệ thống KHÔNG lọt vào danh sách',
    !(list.body?.data?.items ?? []).some((o: any) => o.slug === 'platform'),
  );

  const search = await auth(request(http).get(api(`/super-admin/organizations?search=${encodeURIComponent(OWNER)}`)));
  check('Search theo email Owner (§6)', (search.body?.data?.items ?? []).some((o: any) => o.id === orgId));

  const dash = await auth(request(http).get(api('/super-admin/dashboard')));
  check('GET /super-admin/dashboard → 200', dash.status === 200, dash.body);
  check('Dashboard đủ 4 số (§10)', ['pending', 'approved', 'rejected', 'total'].every((k) => typeof dash.body?.data?.[k] === 'number'), dash.body?.data);

  const detail = await auth(request(http).get(api(`/super-admin/organizations/${orgId}`)));
  check('GET chi tiết → 200 kèm Owner (§7)', detail.status === 200 && detail.body?.data?.owner?.email === OWNER, detail.body?.data);

  console.log('\n▶ 5. Org Admin KHÔNG truy cập được khu Super Admin');
  await resetLoginLimit();
  const demo = await request(http)
    .post(api('/auth/login'))
    .send({ email: 'admin@demo.ncmedia.local', password: 'ChangeMe123' });
  const demoToken = demo.body?.data?.tokens?.accessToken as string;
  check('Org Admin (demo) login → 200', demo.status === 200, demo.body);
  const denied = await request(http)
    .get(api('/super-admin/organizations'))
    .set('Authorization', `Bearer ${demoToken}`);
  check('🔴 Org Admin → 403 ở /super-admin', denied.status === 403, denied.body);

  const noToken = await request(http).get(api('/super-admin/organizations'));
  check('Không token → 401', noToken.status === 401, noToken.body);

  console.log('\n▶ 6. Approve');
  const approve = await auth(request(http).post(api(`/super-admin/organizations/${orgId}/approve`)));
  check('POST approve → 200', approve.status === 200, approve.body);
  check('status = ACTIVE', approve.body?.data?.status === 'ACTIVE', approve.body?.data?.status);
  check('approvedBy + approvedAt được ghi (§8)', Boolean(approve.body?.data?.approvedBy && approve.body?.data?.approvedAt));

  const ownerAfter = await prisma.user.findUnique({ where: { email: OWNER }, select: { status: true } });
  check('🔴 Chủ Organization đổi PENDING → ACTIVE', ownerAfter?.status === 'ACTIVE', ownerAfter);

  const logs = await prisma.organizationApprovalLog.findMany({ where: { organizationId: orgId } });
  check('Audit log APPROVE (§13)', logs.length === 1 && logs[0].action === 'APPROVE' && logs[0].oldStatus === 'PENDING' && logs[0].newStatus === 'ACTIVE', logs);
  check('Audit log lưu Operator', Boolean(logs[0]?.operatorEmail && logs[0]?.operatorId));

  console.log('\n▶ 7. Login được sau khi Approve');
  await resetLoginLimit();
  const ok = await request(http).post(api('/auth/login')).send({ email: OWNER, password: PASSWORD });
  check('POST /auth/login → 200', ok.status === 200, ok.body);
  check('Có accessToken', Boolean(ok.body?.data?.tokens?.accessToken));
  const me = await request(http).get(api('/auth/me')).set('Authorization', `Bearer ${ok.body?.data?.tokens?.accessToken}`);
  check('GET /auth/me → 200', me.status === 200, me.body);
  check(
    '🔴 Org Admin mới KHÔNG có quyền platform.*',
    !(me.body?.data?.permissions ?? []).some((p: string) => p.startsWith('platform.')),
    (me.body?.data?.permissions ?? []).filter((p: string) => p.startsWith('platform.')),
  );

  console.log('\n▶ 8. Approve lần hai bị chặn');
  const twice = await auth(request(http).post(api(`/super-admin/organizations/${orgId}/approve`)));
  check('Approve lại → 400 (chỉ PENDING)', twice.status === 400, twice.body);

  console.log('\n▶ 9. Reject (org thứ hai)');
  const reg2 = await request(http).post(api('/auth/register')).send({
    organizationName: `Beta Test ${stamp}`,
    fullName: 'Owner Beta',
    email: OWNER2,
    password: PASSWORD,
  });
  const orgId2 = reg2.body?.data?.organization?.id as string;

  const noReason = await auth(request(http).post(api(`/super-admin/organizations/${orgId2}/reject`)).send({}));
  check('🔴 Reject thiếu reason → 400 (§9 bắt buộc)', noReason.status === 400, noReason.body);

  const shortReason = await auth(request(http).post(api(`/super-admin/organizations/${orgId2}/reject`)).send({ reason: 'no' }));
  check('Reject reason quá ngắn → 400', shortReason.status === 400, shortReason.body);

  const REASON = 'Thông tin doanh nghiệp chưa xác minh được.';
  const rej = await auth(request(http).post(api(`/super-admin/organizations/${orgId2}/reject`)).send({ reason: REASON }));
  check('POST reject → 200', rej.status === 200, rej.body);
  check('status = REJECTED', rej.body?.data?.status === 'REJECTED');
  check('rejectedBy/At/Reason được ghi (§9)', rej.body?.data?.rejectedReason === REASON && Boolean(rej.body?.data?.rejectedBy && rej.body?.data?.rejectedAt), rej.body?.data);

  await resetLoginLimit();
  const blocked2 = await request(http).post(api('/auth/login')).send({ email: OWNER2, password: PASSWORD });
  check('Login sau REJECTED → 403', blocked2.status === 403, blocked2.body);
  check('code = AUTH_ORGANIZATION_REJECTED', blocked2.body?.code === 'AUTH_ORGANIZATION_REJECTED', blocked2.body);

  const logs2 = await prisma.organizationApprovalLog.findMany({ where: { organizationId: orgId2 } });
  check('Audit log REJECT kèm reason (§13)', logs2.length === 1 && logs2[0].action === 'REJECT' && logs2[0].reason === REASON, logs2);

  console.log('\n▶ 10. Không ảnh hưởng Organization đang ACTIVE');
  await resetLoginLimit();
  const demo2 = await request(http).post(api('/auth/login')).send({ email: 'admin@demo.ncmedia.local', password: 'ChangeMe123' });
  check('🔴 Demo Org (ACTIVE) vẫn login bình thường', demo2.status === 200, demo2.body);

  // --- dọn dẹp ---
  await prisma.organizationApprovalLog.deleteMany({ where: { organizationId: { in: [orgId, orgId2] } } });
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId: { in: [orgId, orgId2] } } } });
  await prisma.refreshToken.deleteMany({ where: { user: { organizationId: { in: [orgId, orgId2] } } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: [orgId, orgId2] } } });
  await prisma.role.deleteMany({ where: { organizationId: { in: [orgId, orgId2] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, orgId2] } } });
  console.log('\n🧹 Đã dọn dữ liệu test.');

  console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
  await prisma.$disconnect();
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
