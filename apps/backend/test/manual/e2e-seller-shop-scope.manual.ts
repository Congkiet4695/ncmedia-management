/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI phân quyền Seller theo Shop, trên DATABASE THẬT + HTTP THẬT.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-seller-shop-scope.manual.ts
 * Cần backend đang chạy ở :3000 (npm run start:dev).
 *
 * Kịch bản §13 của yêu cầu:
 *
 *   Seller A ──▶ Account A ──▶ Shop 1, Shop 2
 *   Seller B ──▶ Account B ──▶ Shop 3, Shop 4
 *
 *   Seller A KHÔNG được thấy Shop 3, Shop 4 · Seller B KHÔNG được thấy Shop 1, Shop 2.
 *
 * 🔴 Đây là thứ duy nhất chứng minh được phân quyền hoạt động THẬT. Unit test đã mock
 * `PodAccessScopeService` nên nó chỉ chứng minh code gọi đúng hàm — không chứng minh câu
 * truy vấn thật sự lọc, cũng không chứng minh guard thật sự được gắn vào route.
 *
 * Kiểm CẢ HAI mặt, vì mỗi mặt bắt một loại lỗi khác nhau:
 *   · DANH SÁCH bị lọc      → bắt lỗi quên `where`.
 *   · TRUY CẬP THẲNG bị 403 → bắt lỗi "ẩn trên UI nhưng API vẫn trả" (§11).
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
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300));
  }
}

async function main() {
  const prisma = new PrismaClient();

  const org = await prisma.organization.findFirst({
    where: { isPlatform: false, deletedAt: null },
    select: { id: true, slug: true },
  });
  if (!org) throw new Error('Chưa có Organization nào để chạy kịch bản này');
  const orgId = org.id;

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
  };

  try {
    // -------------------------------------------------------------------------
    console.log('\n▶ 0. Dựng dữ liệu: 2 Seller × 1 Account × 2 Shop');
    // -------------------------------------------------------------------------
    async function makeSeller(tag: string, shopNames: [string, string]) {
      const user = await prisma.user.create({
        data: {
          organizationId: orgId,
          roleId: employeeRole!.id,
          email: `scope.${tag}.${STAMP}@e2e-test.local`,
          // Không cần đăng nhập thật — token ký trực tiếp bên dưới. Băm giả nhưng hợp lệ độ dài.
          passwordHash: '$2b$10$e2eTestOnlyHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          fullName: `Seller ${tag}`,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      created.userIds.push(user.id);

      const employee = await prisma.employee.create({
        data: {
          organizationId: orgId,
          userId: user.id,
        },
        select: { id: true },
      });
      created.employeeIds.push(employee.id);

      const account = await prisma.podTiktokAccount.create({
        data: {
          organizationId: orgId,
          accountName: `E2E Account ${tag}`,
          openId: `e2e-open-${tag}-${STAMP}`,
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

      const shops = [];
      for (const name of shopNames) {
        const shop = await prisma.podTiktokShop.create({
          data: {
            organizationId: orgId,
            accountId: account.id,
            tiktokShopId: `e2e-${name}-${STAMP}`,
            shopCipherEnc: 'e2e',
            name: `E2E ${name}`,
            region: 'US',
            sellerType: 'CROSS_BORDER',
          },
          select: { id: true, name: true },
        });
        created.shopIds.push(shop.id);
        shops.push(shop);
      }
      return { userId: user.id, accountId: account.id, shops };
    }

    const A = await makeSeller('A', ['Shop 1', 'Shop 2']);
    const B = await makeSeller('B', ['Shop 3', 'Shop 4']);
    check('dựng xong 2 Seller, 2 Account, 4 Shop', created.shopIds.length === 4);

    // Mỗi shop một đơn + một sản phẩm, để danh sách có gì mà lọc.
    for (const [owner, shops] of [
      [A, A.shops],
      [B, B.shops],
    ] as const) {
      for (const shop of shops) {
        const order = await prisma.podOrder.create({
          data: {
            organizationId: orgId,
            accountId: owner.accountId,
            shopId: shop.id,
            tiktokOrderId: `e2e-order-${shop.id}`,
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
          select: { id: true },
        });
        created.orderIds.push(order.id);

        const product = await prisma.podProduct.create({
          data: {
            organizationId: orgId,
            accountId: owner.accountId,
            shopId: shop.id,
            tiktokProductId: `e2e-prod-${shop.id}`,
            title: `E2E Product ${shop.name}`,
            status: 'ACTIVATE',
            payloadHash: '0'.repeat(64),
          },
          select: { id: true },
        });
        created.productIds.push(product.id);
      }
    }
    check('mỗi shop có 1 đơn + 1 sản phẩm', created.orderIds.length === 4);

    // -------------------------------------------------------------------------
    const tokenA = token(A.userId, 'EMPLOYEE');
    const tokenB = token(B.userId, 'EMPLOYEE');
    const json = (r: Response) => r.json().catch(() => null) as any;
    const call = (t: string, path: string) =>
      fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
    const getAs = (t: string, path: string) => call(t, path).then(json);

    const shopsOfA = A.shops.map((s) => s.id);
    const shopsOfB = B.shops.map((s) => s.id);
    const namesOfA = A.shops.map((s) => s.name);
    const namesOfB = B.shops.map((s) => s.name);
    /** Danh sách đơn chỉ trả `shopName` — so bằng tên, đúng thứ người dùng nhìn thấy. */
    const orderShopNames = (res: any): string[] =>
      (res?.data?.items ?? []).map((o: any) => o.shopName ?? o.shop?.name).filter(Boolean);

    // -------------------------------------------------------------------------
    console.log('\n▶ 1. DANH SÁCH bị lọc ở BACKEND (§12 — không lọc ở frontend)');
    // -------------------------------------------------------------------------
    const ordersA = await getAs(tokenA, '/pod/tiktok/orders?limit=100');
    const shopNamesA = orderShopNames(ordersA);
    check(
      'POD Orders của A chỉ chứa Shop 1 & 2',
      shopNamesA.length > 0 && shopNamesA.every((n) => namesOfA.includes(n)),
      shopNamesA,
    );
    check('🔴 POD Orders của A KHÔNG chứa Shop 3/4', !shopNamesA.some((n) => namesOfB.includes(n)));

    const ordersB = await getAs(tokenB, '/pod/tiktok/orders?limit=100');
    const shopNamesB = orderShopNames(ordersB);
    check(
      '🔴 POD Orders của B KHÔNG chứa Shop 1/2',
      shopNamesB.length > 0 && !shopNamesB.some((n) => namesOfA.includes(n)),
      shopNamesB,
    );

    const productsA = await getAs(tokenA, '/pod/products?limit=100');
    const productShopsA = (productsA?.data?.items ?? []).map((p: any) => p.shopId ?? p.shop?.id);
    check(
      '🔴 Products của A KHÔNG chứa shop của B',
      !productShopsA.some((id: string) => shopsOfB.includes(id)),
      productShopsA,
    );

    const accountsA = await getAs(tokenA, '/pod/tiktok/accounts?limit=100');
    const accountIdsA = (accountsA?.data?.items ?? []).map((a: any) => a.id);
    check(
      '🔴 TikTok Accounts của A KHÔNG chứa Account của B',
      !accountIdsA.includes(B.accountId),
      accountIdsA,
    );

    const filtersA = await getAs(tokenA, '/pod/products/filters');
    const dropdownShops = (filtersA?.data?.shops ?? []).map((s: any) => s.id);
    check(
      '🔴 Dropdown Shop (bộ lọc sản phẩm) chỉ có shop được gán (§4)',
      dropdownShops.length > 0 && dropdownShops.every((id: string) => shopsOfA.includes(id)),
      dropdownShops,
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 2. Truyền THẲNG shopId của người khác ⇒ KHÔNG có dữ liệu / 403 (§11)');
    // -------------------------------------------------------------------------
    const crossFilter = await getAs(tokenA, `/pod/tiktok/orders?shopId=${shopsOfB[0]}&limit=100`);
    const crossItems = crossFilter?.data?.items ?? [];
    check(
      '🔴 A lọc theo Shop 3 ⇒ rỗng hoặc bị chặn (KHÔNG trả đơn của B)',
      crossFilter?.success === false || crossItems.length === 0,
      { code: crossFilter?.code, count: crossItems.length },
    );

    const crossOrderRes = await call(tokenA, `/pod/tiktok/orders/${created.orderIds[2]}`);
    check(
      '🔴 A mở THẲNG đơn của Shop 3 ⇒ 403/404, không phải 200',
      crossOrderRes.status === 403 || crossOrderRes.status === 404,
      crossOrderRes.status,
    );

    const crossProductRes = await call(tokenA, `/pod/products/${created.productIds[2]}`);
    check(
      '🔴 A mở THẲNG sản phẩm của Shop 3 ⇒ 403/404',
      crossProductRes.status === 403 || crossProductRes.status === 404,
      crossProductRes.status,
    );

    const crossAccountRes = await call(tokenA, `/pod/tiktok/accounts/${B.accountId}`);
    check(
      '🔴 A mở THẲNG Account của B ⇒ 403/404',
      crossAccountRes.status === 403 || crossAccountRes.status === 404,
      crossAccountRes.status,
    );

    const crossStateRes = await call(tokenA, `/fulfillment/orders/${created.orderIds[2]}`);
    check(
      '🔴 A xem trạng thái fulfillment đơn của B ⇒ 403/404',
      crossStateRes.status === 403 || crossStateRes.status === 404,
      crossStateRes.status,
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 3. Hành động BỊ CẤM của Seller ⇒ 403 (§7 — không chỉ ẩn nút)');
    // -------------------------------------------------------------------------
    const ownOrderId = created.orderIds[0];
    const post = (t: string, path: string, body?: unknown) =>
      fetch(`${API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    for (const [label, path, body] of [
      ['Fulfill', `/fulfillment/orders/${ownOrderId}/fulfill`, undefined],
      ['Retry', `/fulfillment/orders/${ownOrderId}/retry`, undefined],
      ['Cancel', `/fulfillment/orders/${ownOrderId}/cancel`, { reason: 'e2e' }],
      ['Sync toàn tổ chức', '/fulfillment/sync', {}],
      ['Sync Orders', '/pod/tiktok/orders/sync', {}],
      ['Sync Products', '/pod/products/sync', {}],
      ['Tạo Fulfillment Provider', '/fulfillment/accounts', { name: 'x' }],
    ] as const) {
      const res = await post(tokenA, path, body);
      check(`🔴 Seller gọi "${label}" trên ĐƠN CỦA CHÍNH MÌNH ⇒ 403`, res.status === 403, {
        path,
        status: res.status,
      });
    }

    // -------------------------------------------------------------------------
    console.log('\n▶ 4. Hành động ĐƯỢC PHÉP của Seller vẫn chạy (§7, §8)');
    // -------------------------------------------------------------------------
    const ownOrder = await getAs(tokenA, `/pod/tiktok/orders/${ownOrderId}`);
    check('Seller mở được đơn của shop MÌNH', ownOrder?.data?.id === ownOrderId, ownOrder?.code);

    const ownState = await call(tokenA, `/fulfillment/orders/${ownOrderId}`);
    check(
      'Seller xem được trạng thái fulfillment đơn của mình (không 403)',
      ownState.status !== 403,
      ownState.status,
    );

    const payoutA = await call(tokenA, '/pod/tiktok/payout/summary');
    check('Seller xem được TikTok Payout (§9)', payoutA.status === 200, payoutA.status);

    const templatesA = await call(tokenA, '/pod/listing-templates?limit=5');
    check('Seller xem được Templates (§3 — theo tổ chức, không theo shop)', templatesA.status === 200, templatesA.status);

    // -------------------------------------------------------------------------
    console.log('\n▶ 5. Admin vẫn thấy TẤT CẢ (không bị siết nhầm)');
    // -------------------------------------------------------------------------
    const admin = await prisma.user.findFirst({
      where: { organizationId: orgId, roleId: adminRole.id, deletedAt: null },
      select: { id: true },
    });
    if (admin) {
      const ordersAdmin = await getAs(
        token(admin.id, 'ADMIN'),
        '/pod/tiktok/orders?limit=100',
      );
      const adminShops = orderShopNames(ordersAdmin);
      check(
        '🔴 Admin thấy đơn của CẢ hai Seller (pod.shop.all)',
        namesOfA.some((n) => adminShops.includes(n)) &&
          namesOfB.some((n) => adminShops.includes(n)),
        adminShops,
      );
    } else {
      console.log('  … bỏ qua: tổ chức chưa có user ADMIN');
    }
  } finally {
    // -------------------------------------------------------------------------
    console.log('\n🧹 Dọn dữ liệu test');
    // -------------------------------------------------------------------------
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
