/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI: **Seller fulfill đơn của CHÍNH mình** + **Base Cost lấy từ giá nhà cung cấp**,
 * trên DATABASE THẬT + HTTP THẬT (guard thật, route thật).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-seller-fulfill-scope.manual.ts
 * Cần backend đang chạy ở :3000. Nên tắt scheduler khi chạy (TIKTOK_*_ENABLED=false …).
 *
 *   Seller A ──▶ Account A ──▶ Shop A ──▶ Đơn A
 *   Seller B ──▶ Account B ──▶ Shop B ──▶ Đơn B
 *
 * 🔴 KHÔNG gọi TikTok / nhà cung cấp theo cách có tác dụng phụ: mọi ca "bị chặn" phải dừng ở kiểm
 * tra phạm vi TRƯỚC lời gọi ngoài; ca "được phép" dùng shop giả (token/cipher không giải mã được) nên
 * dừng ở bước dựng ngữ cảnh shop, và đơn không có dòng hàng nên không bao giờ tới API tạo đơn.
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối.
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

  // Tổ chức có tài khoản nhà cung cấp đã đồng bộ danh mục (để kiểm giá thật).
  const variant = await prisma.fulfillmentVariant.findFirst({
    where: { deletedAt: null, status: 'ACTIVE', price: { not: null } },
    orderBy: { sku: 'asc' },
    select: { id: true, sku: true, externalVariantId: true, price: true, accountId: true },
  });
  if (!variant) throw new Error('Chưa có biến thể nhà cung cấp nào được đồng bộ');
  const providerAccount = await prisma.fulfillmentAccount.findUniqueOrThrow({
    where: { id: variant.accountId },
    select: { id: true, organizationId: true, provider: true },
  });
  const orgId = providerAccount.organizationId;

  const roles = await prisma.role.findMany({
    where: { organizationId: orgId, code: { in: ['ADMIN', 'EMPLOYEE'] }, deletedAt: null },
    select: { id: true, code: true },
  });
  const employeeRole = roles.find((r) => r.code === 'EMPLOYEE');
  const adminRole = roles.find((r) => r.code === 'ADMIN');
  if (!employeeRole || !adminRole) throw new Error('Thiếu Role ADMIN/EMPLOYEE — chạy `prisma db seed`');

  const token = (userId: string, roleCode: string) =>
    jwt.sign(
      { sub: userId, organizationId: orgId, role: roleCode, jti: randomUUID() },
      process.env.JWT_ACCESS_SECRET as string,
      { algorithm: 'HS256', expiresIn: 900 },
    );

  const created = {
    userIds: [] as string[],
    employeeIds: [] as string[],
    accountIds: [] as string[],
    shopIds: [] as string[],
    orderIds: [] as string[],
    productIds: [] as string[],
    mappingIds: [] as string[],
  };

  try {
    console.log('\n▶ 0. Dựng dữ liệu: 2 Seller × 1 Account × 1 Shop × 1 Đơn');
    async function makeSeller(tag: string) {
      const user = await prisma.user.create({
        data: {
          organizationId: orgId,
          roleId: employeeRole!.id,
          email: `fulfill.${tag}.${STAMP}@e2e-test.local`,
          passwordHash: '$2b$10$e2eTestOnlyHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          fullName: `Seller ${tag}`,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      created.userIds.push(user.id);
      const employee = await prisma.employee.create({
        data: { organizationId: orgId, userId: user.id },
        select: { id: true },
      });
      created.employeeIds.push(employee.id);
      const account = await prisma.podTiktokAccount.create({
        data: {
          organizationId: orgId,
          accountName: `E2E Fulfill ${tag}`,
          openId: `e2e-ful-${tag}-${STAMP}`,
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
          tiktokShopId: `e2e-ful-${tag}-${STAMP}`,
          shopCipherEnc: 'e2e',
          name: `E2E Fulfill Shop ${tag}`,
          region: 'US',
          sellerType: 'CROSS_BORDER',
        },
        select: { id: true },
      });
      created.shopIds.push(shop.id);
      const order = await prisma.podOrder.create({
        data: {
          organizationId: orgId,
          accountId: account.id,
          shopId: shop.id,
          tiktokOrderId: `e2e-ful-order-${tag}-${STAMP}`,
          status: 'AWAITING_SHIPMENT',
          shippingType: 'TIKTOK',
          tiktokCreateTime: BigInt(Math.floor(Date.now() / 1000)),
          tiktokUpdateTime: BigInt(Math.floor(Date.now() / 1000)),
          orderedAt: new Date(),
          tiktokUpdatedAt: new Date(),
          payloadHash: '0'.repeat(64),
          rawPayload: {},
          syncSource: 'MANUAL',
          lastSyncedAt: new Date(),
        },
        select: { id: true },
      });
      created.orderIds.push(order.id);
      const product = await prisma.podProduct.create({
        data: {
          organizationId: orgId,
          accountId: account.id,
          shopId: shop.id,
          tiktokProductId: `e2e-ful-prod-${tag}-${STAMP}`,
          title: `E2E Fulfill Product ${tag}`,
          status: 'ACTIVATE',
          payloadHash: '0'.repeat(64),
        },
        select: { id: true, tiktokProductId: true },
      });
      created.productIds.push(product.id);
      return { userId: user.id, orderId: order.id, tiktokProductId: product.tiktokProductId };
    }
    const A = await makeSeller('A');
    const B = await makeSeller('B');
    check('dựng xong 2 Seller, 2 Shop, 2 Đơn', created.orderIds.length === 2);

    const tokenA = token(A.userId, 'EMPLOYEE');
    const req = (t: string | null, method: string, path: string, body?: unknown) =>
      fetch(`${API}${path}`, {
        method,
        headers: {
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const bodyOf = async (r: Response) => (await r.json().catch(() => null)) as any;
    const labelOf = (id: string) =>
      prisma.podOrder.findUniqueOrThrow({ where: { id }, select: { shippingLabelUrl: true } });

    // -------------------------------------------------------------------------
    console.log('\n▶ 1. Route /pod/orders có guard (trước đây: 500 "Internal server error")');
    const noToken = await req(null, 'POST', `/pod/orders/${A.orderId}/fulfillment/tiktok-label`, {});
    check('🔴 không token ⇒ 401 (không còn 500)', noToken.status === 401, noToken.status);

    // -------------------------------------------------------------------------
    console.log('\n▶ 2. Seller A thao tác trên đơn của Seller B ⇒ 403 ở backend');
    const forbidden: Array<[string, string, string, unknown?]> = [
      ['lấy nhãn TikTok', 'POST', `/pod/orders/${B.orderId}/fulfillment/tiktok-label`, {}],
      ['lưu nhãn dán tay', 'PUT', `/pod/orders/${B.orderId}/fulfillment/label`, { labelUrl: 'https://evil.test/l.pdf' }],
      ['gỡ nhãn', 'DELETE', `/pod/orders/${B.orderId}/fulfillment/label`],
      ['sửa đơn đã gửi', 'PATCH', `/pod/orders/${B.orderId}/fulfillment`, { note: 'x' }],
      ['fulfill (/pod/orders)', 'POST', `/pod/orders/${B.orderId}/fulfill`, {}],
      ['fulfill (/fulfillment/orders)', 'POST', `/fulfillment/orders/${B.orderId}/fulfill`, {}],
      ['retry', 'POST', `/fulfillment/orders/${B.orderId}/retry`, {}],
      ['xem trạng thái', 'GET', `/fulfillment/orders/${B.orderId}`],
    ];
    for (const [label, method, path, body] of forbidden) {
      const r = await req(tokenA, method, path, body);
      const b = await bodyOf(r);
      check(`${label} ⇒ 403 POD_SHOP_FORBIDDEN`, r.status === 403 && b?.code === 'POD_SHOP_FORBIDDEN', { status: r.status, code: b?.code });
    }
    check('nhãn của đơn B KHÔNG bị ghi', (await labelOf(B.orderId)).shippingLabelUrl === null);

    const cancel = await req(tokenA, 'POST', `/fulfillment/orders/${A.orderId}/cancel`, {});
    check('huỷ ở xưởng (fulfillment.cancel) ⇒ Seller KHÔNG có quyền', cancel.status === 403, cancel.status);
    const orgSync = await req(tokenA, 'POST', '/fulfillment/sync', {});
    const orgSyncBody = await bodyOf(orgSync);
    check('🔴 đồng bộ hàng loạt CẢ tổ chức ⇒ 403 AUTH_FORBIDDEN', orgSync.status === 403 && orgSyncBody?.code === 'AUTH_FORBIDDEN', { status: orgSync.status, code: orgSyncBody?.code });

    const foreign = await req(tokenA, 'POST', `/fulfillment/orders/${randomUUID()}/fulfill`, {});
    check('đơn không thuộc tổ chức (ID bịa) ⇒ 404', foreign.status === 404, foreign.status);

    // -------------------------------------------------------------------------
    console.log('\n▶ 3. Seller A thao tác trên đơn CỦA MÌNH ⇒ được phép');
    const save = await req(tokenA, 'PUT', `/pod/orders/${A.orderId}/fulfillment/label`, { labelUrl: 'https://label.test/a.pdf' });
    check('lưu nhãn đơn của mình ⇒ 200', save.status === 200, save.status);
    check('nhãn đã ghi xuống database', (await labelOf(A.orderId)).shippingLabelUrl === 'https://label.test/a.pdf');
    const clear = await req(tokenA, 'DELETE', `/pod/orders/${A.orderId}/fulfillment/label`);
    check('gỡ nhãn đơn của mình ⇒ 204', clear.status === 204, clear.status);

    const state = await req(tokenA, 'GET', `/fulfillment/orders/${A.orderId}`);
    check('xem trạng thái fulfillment đơn của mình ⇒ 200', state.status === 200, state.status);

    const ownFulfill = await req(tokenA, 'POST', `/pod/orders/${A.orderId}/fulfill`, { fulfillmentAccountId: providerAccount.id });
    const ownFulfillBody = await bodyOf(ownFulfill);
    check(
      'fulfill đơn của mình ⇒ QUA được phân quyền (lỗi nghiệp vụ vì đơn test không có sản phẩm, không phải 401/403/500)',
      ![401, 403, 500].includes(ownFulfill.status),
      { status: ownFulfill.status, code: ownFulfillBody?.code },
    );
    const submitted = await prisma.fulfillmentOrder.count({
      where: { podOrderId: A.orderId, status: { in: ['SUBMITTED', 'SUBMITTING'] } },
    });
    check('đơn test KHÔNG bị gửi sang nhà cung cấp', submitted === 0, submitted);

    const ownLabel = await req(tokenA, 'POST', `/pod/orders/${A.orderId}/fulfillment/tiktok-label`, {});
    const ownLabelBody = await bodyOf(ownLabel);
    check(
      'lấy nhãn đơn của mình ⇒ QUA phân quyền, lỗi có mã rõ ràng (shop test không có token thật)',
      ![401, 403, 500].includes(ownLabel.status) && typeof ownLabelBody?.code === 'string',
      { status: ownLabel.status, code: ownLabelBody?.code },
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 4. Admin vẫn làm được trên đơn của mọi Seller');
    const admin = await prisma.user.findFirst({
      where: { organizationId: orgId, roleId: adminRole.id, deletedAt: null },
      select: { id: true },
    });
    if (admin) {
      const tokenAdmin = token(admin.id, 'ADMIN');
      const adminSave = await req(tokenAdmin, 'PUT', `/pod/orders/${B.orderId}/fulfillment/label`, { labelUrl: 'https://label.test/b.pdf' });
      check('Admin lưu nhãn đơn của Seller B ⇒ 200', adminSave.status === 200, adminSave.status);
      const adminClear = await req(tokenAdmin, 'DELETE', `/pod/orders/${B.orderId}/fulfillment/label`);
      check('Admin gỡ nhãn ⇒ 204', adminClear.status === 204, adminClear.status);
    } else {
      console.log('  … bỏ qua: tổ chức chưa có user ADMIN');
    }

    // -------------------------------------------------------------------------
    console.log('\n▶ 5. Giá biến thể nhà cung cấp → Base Cost');
    const priceRes = await req(tokenA, 'GET', `/fulfillment/accounts/${providerAccount.id}/catalog/variations/${variant.id}/price`);
    const priceBody = await bodyOf(priceRes);
    check(
      `Seller lấy được giá của biến thể ${variant.sku} = giá đã đồng bộ (${variant.price})`,
      priceRes.status === 200 && priceBody?.data?.price === Number(variant.price) && priceBody?.data?.sku === variant.sku,
      { status: priceRes.status, data: priceBody?.data, code: priceBody?.code },
    );
    const missingRes = await req(tokenA, 'GET', `/fulfillment/accounts/${providerAccount.id}/catalog/variations/${randomUUID()}/price`);
    const missingBody = await bodyOf(missingRes);
    check(
      'biến thể không tồn tại ⇒ 422 FULFILLMENT_VARIANT_PRICE_UNAVAILABLE (không trả 0)',
      missingRes.status === 422 && missingBody?.code === 'FULFILLMENT_VARIANT_PRICE_UNAVAILABLE',
      { status: missingRes.status, code: missingBody?.code },
    );

    const create = await req(tokenA, 'POST', `/fulfillment/mappings?provider=${providerAccount.provider}`, {
      accountId: providerAccount.id,
      tiktokProductId: A.tiktokProductId,
      sellerSku: `E2E-SELLER-${STAMP}`,
      providerSku: variant.sku,
      providerVariantId: variant.externalVariantId,
      baseCost: 999,
    });
    const createBody = await bodyOf(create);
    if (createBody?.data?.id) created.mappingIds.push(createBody.data.id);
    check(
      '🔴 lưu ánh xạ ⇒ Base Cost = giá nhà cung cấp, BỎ QUA 999 do client gửi',
      create.status === 201 && createBody?.data?.baseCost === Number(variant.price) && createBody?.data?.baseCostStatus === 'PROVIDER_PRICE',
      { status: create.status, baseCost: createBody?.data?.baseCost, st: createBody?.data?.baseCostStatus, code: createBody?.code },
    );
    if (createBody?.data?.id) {
      const stored = await prisma.fulfillmentProductMapping.findUniqueOrThrow({
        where: { id: createBody.data.id },
        select: { baseCost: true },
      });
      check('Base Cost đã ghi xuống database', Number(stored.baseCost) === Number(variant.price), stored.baseCost);
    }

    const otherShopMapping = await req(tokenA, 'POST', `/fulfillment/mappings?provider=${providerAccount.provider}`, {
      accountId: providerAccount.id,
      tiktokProductId: B.tiktokProductId,
      sellerSku: `E2E-SELLER-B-${STAMP}`,
      providerSku: variant.sku,
    });
    const otherShopMappingBody = await bodyOf(otherShopMapping);
    if (otherShopMappingBody?.data?.id) created.mappingIds.push(otherShopMappingBody.data.id);
    check('Seller A khai ánh xạ cho sản phẩm của shop B ⇒ 403', otherShopMapping.status === 403, otherShopMapping.status);
  } finally {
    console.log('\n🧹 Dọn dữ liệu test');
    await prisma.fulfillmentProductMapping.deleteMany({ where: { id: { in: created.mappingIds } } });
    await prisma.fulfillmentOrder.deleteMany({ where: { podOrderId: { in: created.orderIds } } }).catch(() => undefined);
    await prisma.podOrderPackage.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.podOrderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.podOrder.deleteMany({ where: { id: { in: created.orderIds } } });
    await prisma.podProduct.deleteMany({ where: { id: { in: created.productIds } } });
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
