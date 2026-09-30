/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI: **Seller huỷ fulfillment** trên DATABASE THẬT + HTTP THẬT (guard, route thật).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-seller-cancel-fulfillment.manual.ts
 * Cần backend đang chạy ở :3000.
 *
 *   Seller A ──▶ Account A ──▶ Shop A ──▶ Đơn A1 (CANCELLED) · Đơn A2 (IN_PRODUCTION) · Đơn A3 (chưa gửi)
 *   Seller B ──▶ Account B ──▶ Shop B ──▶ Đơn B1 (SUBMITTED)
 *
 * 🔴 KHÔNG gọi nhà cung cấp: mọi ca đều phải dừng ở kiểm tra quyền / phạm vi / trạng thái — những
 * kiểm tra này đứng TRƯỚC lời gọi ra ngoài. Huỷ thật ở Mango / Sellerwix không chạy ở đây (tốn tiền /
 * không có tài khoản) — xem unit test của từng adapter.
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3000/api/v1';
const STAMP = Date.now();

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
  const providerAccount = await prisma.fulfillmentAccount.findFirstOrThrow({
    where: { deletedAt: null, provider: 'MANGO', isGlobal: false },
    select: { id: true, organizationId: true, provider: true },
  });
  const orgId = providerAccount.organizationId;
  const roles = await prisma.role.findMany({
    where: { organizationId: orgId, code: { in: ['ADMIN', 'EMPLOYEE'] }, deletedAt: null },
    select: { id: true, code: true },
  });
  const employeeRole = roles.find((r) => r.code === 'EMPLOYEE')!;
  const admin = await prisma.user.findFirstOrThrow({
    where: { organizationId: orgId, role: { code: 'ADMIN' }, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });

  const token = (userId: string, roleCode: string) =>
    jwt.sign({ sub: userId, organizationId: orgId, role: roleCode, jti: randomUUID() }, process.env.JWT_ACCESS_SECRET as string, {
      algorithm: 'HS256',
      expiresIn: 900,
    });
  const req = async (tk: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const created = { userIds: [] as string[], employeeIds: [] as string[], accountIds: [] as string[], shopIds: [] as string[], orderIds: [] as string[] };

  async function makeSeller(tag: string) {
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        roleId: employeeRole.id,
        email: `cancel.${tag}.${STAMP}@e2e-test.local`,
        passwordHash: '$2b$10$e2eTestOnlyHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        fullName: `Seller ${tag} ${STAMP}`,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    created.userIds.push(user.id);
    const employee = await prisma.employee.create({ data: { organizationId: orgId, userId: user.id }, select: { id: true } });
    created.employeeIds.push(employee.id);
    const account = await prisma.podTiktokAccount.create({
      data: {
        organizationId: orgId,
        accountName: `E2E Cancel ${tag}`,
        openId: `e2e-cancel-${tag}-${STAMP}`,
        userType: 0,
        accessTokenEnc: 'e2e',
        accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
        refreshTokenEnc: 'e2e',
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
        status: 'ACTIVE',
        sellerId: employee.id,
      },
      select: { id: true },
    });
    created.accountIds.push(account.id);
    const shop = await prisma.podTiktokShop.create({
      data: {
        organizationId: orgId,
        accountId: account.id,
        tiktokShopId: `e2e-cancel-${tag}-${STAMP}`,
        shopCipherEnc: 'e2e',
        name: `E2E Cancel Shop ${tag}`,
        region: 'US',
        sellerType: 'CROSS_BORDER',
      },
      select: { id: true },
    });
    created.shopIds.push(shop.id);
    return { userId: user.id, accountId: account.id, shopId: shop.id };
  }

  async function makeOrder(owner: { accountId: string; shopId: string }, tag: string, status: string | null) {
    const order = await prisma.podOrder.create({
      data: {
        organizationId: orgId,
        accountId: owner.accountId,
        shopId: owner.shopId,
        tiktokOrderId: `e2e-cancel-${tag}-${STAMP}`,
        status: 'AWAITING_SHIPMENT',
        tiktokCreateTime: BigInt(Math.floor(Date.now() / 1000)),
        tiktokUpdateTime: BigInt(Math.floor(Date.now() / 1000)),
        orderedAt: new Date(),
        tiktokUpdatedAt: new Date(),
        payloadHash: '0'.repeat(64),
        rawPayload: {},
        syncSource: 'MANUAL',
        lastSyncedAt: new Date(),
      },
      select: { id: true, tiktokOrderId: true },
    });
    created.orderIds.push(order.id);
    let fulfillmentId: string | null = null;
    if (status) {
      const record = await prisma.fulfillmentOrder.create({
        data: {
          organizationId: orgId,
          accountId: providerAccount.id,
          provider: providerAccount.provider,
          podOrderId: order.id,
          externalOrderId: `NC-${order.tiktokOrderId}`.slice(0, 40),
          providerOrderId: `MG-E2E-${tag}-${STAMP}`,
          status: status as never,
          submittedAt: new Date(),
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
        },
        select: { id: true },
      });
      fulfillmentId = record.id;
    }
    return { orderId: order.id, fulfillmentId };
  }

  try {
    console.log('\n▶ 0. Dựng dữ liệu');
    const A = await makeSeller('A');
    const B = await makeSeller('B');
    const a1 = await makeOrder(A, 'A1', 'CANCELLED');
    const a2 = await makeOrder(A, 'A2', 'IN_PRODUCTION');
    const a3 = await makeOrder(A, 'A3', null);
    const b1 = await makeOrder(B, 'B1', 'SUBMITTED');
    await prisma.fulfillmentHistory.create({
      data: {
        organizationId: orgId,
        fulfillmentOrderId: a1.fulfillmentId!,
        eventType: 'CANCEL_REQUEST',
        trigger: 'MANUAL',
        fromStatus: 'SUBMITTED',
        message: 'Yêu cầu huỷ: sai size',
        payload: { reason: 'sai size', actorRole: 'EMPLOYEE' },
        performedBy: A.userId,
      },
    });
    const otherOrgOrder = await prisma.podOrder.findFirst({ where: { organizationId: { not: orgId } }, select: { id: true } });

    const tA = token(A.userId, 'EMPLOYEE');
    const tAdmin = token(admin.id, 'ADMIN');

    console.log('\n▶ 1. Phân quyền / phạm vi');
    const other = await req(tA, 'POST', `/fulfillment/orders/${b1.orderId}/cancel`, { reason: 'x' });
    check('Seller A huỷ đơn của shop B ⇒ 403', other.status === 403, other);
    const stillSubmitted = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: b1.fulfillmentId! }, select: { status: true } });
    check('đơn shop B không bị đụng tới', stillSubmitted.status === 'SUBMITTED');
    if (otherOrgOrder) {
      const cross = await req(tA, 'POST', `/fulfillment/orders/${otherOrgOrder.id}/cancel`, {});
      check('Seller huỷ đơn của TỔ CHỨC KHÁC ⇒ 404', cross.status === 404, cross);
    } else {
      console.log('  (bỏ qua: DB không có đơn của tổ chức khác)');
    }
    const random = await req(tA, 'POST', `/fulfillment/orders/${randomUUID()}/cancel`, {});
    check('đơn không tồn tại ⇒ 404', random.status === 404, random);

    console.log('\n▶ 2. Seller CÓ quyền fulfillment.cancel (qua được guard) — trạng thái quyết định');
    const notSent = await req(tA, 'POST', `/fulfillment/orders/${a3.orderId}/cancel`, {});
    check('đơn của mình chưa từng fulfill ⇒ 404 FULFILLMENT_ORDER_NOT_FOUND', notSent.status === 404 && notSent.body?.code === 'FULFILLMENT_ORDER_NOT_FOUND', notSent.body);
    const twice = await req(tA, 'POST', `/fulfillment/orders/${a1.orderId}/cancel`, {});
    check('đơn ĐÃ huỷ ⇒ 409 FULFILLMENT_CANNOT_CANCEL (không huỷ hai lần)', twice.status === 409 && twice.body?.code === 'FULFILLMENT_CANNOT_CANCEL', twice.body);
    const inProd = await req(tA, 'POST', `/fulfillment/orders/${a2.orderId}/cancel`, {});
    check('đơn đã vào sản xuất ⇒ 409 FULFILLMENT_CANNOT_CANCEL', inProd.status === 409 && inProd.body?.code === 'FULFILLMENT_CANNOT_CANCEL', inProd.body);
    const adminTwice = await req(tAdmin, 'POST', `/fulfillment/orders/${a1.orderId}/cancel`, {});
    check('Admin vẫn dùng cùng endpoint (đơn đã huỷ ⇒ 409)', adminTwice.status === 409, adminTwice.body);

    console.log('\n▶ 3. Đồng thời');
    const concurrent = await Promise.all([
      req(tA, 'POST', `/fulfillment/orders/${a1.orderId}/cancel`, {}),
      req(tAdmin, 'POST', `/fulfillment/orders/${a1.orderId}/cancel`, {}),
    ]);
    check('hai lần huỷ đồng thời ⇒ đều 409, không 500', concurrent.every((r) => r.status === 409), concurrent.map((r) => [r.status, r.body?.code]));
    const a1After = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: a1.fulfillmentId! }, select: { status: true } });
    check('trạng thái vẫn nhất quán (CANCELLED)', a1After.status === 'CANCELLED');

    console.log('\n▶ 4. Hiển thị sau khi huỷ');
    const state = await req(tA, 'GET', `/fulfillment/orders/${a1.orderId}`);
    check('Seller xem state đơn đã huỷ ⇒ 200', state.status === 200, state.body);
    check('canCancel = false (không còn nút Huỷ)', state.body?.data?.canCancel === false);
    check(
      'cancellation: người huỷ + lý do + thời điểm',
      state.body?.data?.cancellation?.cancelledBy === `Seller A ${STAMP}` &&
        state.body?.data?.cancellation?.reason === 'sai size' &&
        typeof state.body?.data?.cancellation?.cancelledAt === 'string',
      state.body?.data?.cancellation,
    );
    const stateB = await req(tA, 'GET', `/fulfillment/orders/${b1.orderId}`);
    check('Seller A xem state đơn shop B ⇒ 403', stateB.status === 403, stateB.status);
    const stateSubmitted = await req(token(B.userId, 'EMPLOYEE'), 'GET', `/fulfillment/orders/${b1.orderId}`);
    check('Seller B thấy canCancel = true với đơn SUBMITTED của mình', stateSubmitted.body?.data?.canCancel === true, stateSubmitted.body?.data?.canCancel);
    check('đơn chưa huỷ ⇒ cancellation = null', stateSubmitted.body?.data?.cancellation === null);
  } finally {
    console.log('\n🧹 Dọn dữ liệu test');
    await prisma.fulfillmentOrder.deleteMany({ where: { podOrderId: { in: created.orderIds } } });
    await prisma.podOrder.deleteMany({ where: { id: { in: created.orderIds } } });
    await prisma.podTiktokShop.deleteMany({ where: { id: { in: created.shopIds } } });
    await prisma.podTiktokAccount.deleteMany({ where: { id: { in: created.accountIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: created.employeeIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }
}

void main();
