/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI luồng Sellerwix trên HTTP THẬT + DB THẬT + Sellerwix API THẬT (chỉ ĐỌC ở phía
 * Sellerwix — không tạo đơn).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-sellerwix-shipping-flow.manual.ts
 * Cần backend đang chạy ở :3000 và tài khoản Sellerwix đã cấu hình trong DB (dùng ĐÚNG bản ghi đó).
 *
 *  1. Tái hiện lỗi: đơn chưa có cấu hình sản phẩm Sellerwix ⇒ shipping method rỗng + cảnh báo rõ.
 *  2. Provider Product chỉ của Sellerwix (không lẫn Mango), tìm kiếm + phân trang ở server.
 *  3. Lưu cấu hình sản phẩm Sellerwix (ánh xạ TẠM cho sản phẩm CHƯA có ánh xạ) ⇒ shipping method có
 *     dữ liệu thật, nhãn không có UUID.
 *  4. Tuỳ chọn loại thông báo: mặc định / lưu / Seller 403.
 *
 * 🔴 Không đụng ánh xạ hiện có: chỉ dùng sản phẩm chưa ánh xạ; ánh xạ tạm bị xoá hẳn ở cuối.
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3000/api/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
}

async function main() {
  const prisma = new PrismaClient();
  const sellerwix = await prisma.fulfillmentAccount.findFirstOrThrow({ where: { provider: 'SELLERWIX', deletedAt: null } });
  const mango = await prisma.fulfillmentAccount.findFirst({
    where: { provider: 'MANGO', deletedAt: null, isActive: true, organizationId: sellerwix.organizationId },
  });
  const orgId = sellerwix.organizationId;
  const admin = await prisma.user.findFirstOrThrow({
    where: { organizationId: orgId, role: { code: 'ADMIN' }, deletedAt: null, status: 'ACTIVE' },
  });
  const sign = (userId: string, role: string) =>
    jwt.sign({ sub: userId, organizationId: orgId, role, jti: randomUUID() }, process.env.JWT_ACCESS_SECRET as string, {
      algorithm: 'HS256',
      expiresIn: 1800,
    });
  const tk = sign(admin.id, 'ADMIN');
  const call = async (method: string, path: string, body?: unknown, token = tk) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  };

  const createdMappingIds: string[] = [];
  const employeeRole = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, code: 'EMPLOYEE' } });
  const seller = await prisma.user.create({
    data: { organizationId: orgId, roleId: employeeRole.id, email: `swx-e2e-${Date.now()}@e2e-test.local`, fullName: 'E2E', passwordHash: 'x', status: 'ACTIVE' },
  });
  const prefBefore = await prisma.organizationNotificationPreference.findUnique({ where: { organizationId: orgId } });

  try {
    // ---------------------------------------------------------------- tìm đơn chưa cấu hình
    const mapped = await prisma.fulfillmentProductMapping.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { tiktokProductId: true, sellerSku: true },
    });
    const mappedKeys = new Set(mapped.map((m) => `${m.tiktokProductId}|${m.sellerSku}`));
    const orders = await prisma.podOrder.findMany({
      where: { organizationId: orgId, deletedAt: null, items: { some: {} } },
      orderBy: { orderedAt: 'desc' },
      select: { id: true, tiktokOrderId: true, items: { select: { productId: true, sellerSku: true } } },
      take: 50,
    });
    const order = orders.find((o) =>
      o.items.every((i) => i.productId && i.sellerSku && !mappedKeys.has(`${i.productId}|${i.sellerSku}`)),
    );
    if (!order) throw new Error('Không có đơn nào mà mọi sản phẩm đều CHƯA ánh xạ — không chạy được mà không đụng dữ liệu thật');
    console.log(`\nĐơn dùng để kiểm: ${order.tiktokOrderId} (${order.items.length} dòng)`);

    console.log('\n▶ 1. Tái hiện: chưa có cấu hình sản phẩm Sellerwix');
    const before = await call('GET', `/fulfillment/orders/${order.id}/shipping-methods?providerId=${sellerwix.id}`);
    check('GET shipping-methods ⇒ 200', before.status === 200, before.body);
    check(
      'options rỗng + cảnh báo nói rõ phải cấu hình sản phẩm Sellerwix (không rỗng im lặng)',
      before.body?.data?.options?.length === 0 && before.body?.data?.warnings?.length > 0,
      before.body?.data,
    );

    console.log('\n▶ 2. Master data Sellerwix');
    const status = await call('GET', `/fulfillment/accounts/${sellerwix.id}/catalog/status`);
    console.log('   ', JSON.stringify(status.body?.data));
    check('catalog status: có sản phẩm + biến thể, lượt gần nhất SUCCESS', status.body?.data?.products > 0 && status.body?.data?.variants > 0 && status.body?.data?.syncStatus === 'SUCCESS', status.body?.data);
    const page1 = await call('GET', `/fulfillment/accounts/${sellerwix.id}/catalog/products?search=Gildan&page=1&limit=20`);
    const items = page1.body?.data?.items ?? [];
    check('Provider Product: tìm "Gildan" ⇒ có kết quả', items.length > 0, page1.body);
    const productIds = items.map((p: any) => p.id);
    const owners = await prisma.fulfillmentProduct.findMany({ where: { id: { in: productIds } }, select: { accountId: true } });
    check('Provider Product: CHỈ sản phẩm của tài khoản Sellerwix (không lẫn Mango)', owners.length === items.length && owners.every((o) => o.accountId === sellerwix.id));
    check('Provider Product: nhãn không phải UUID', items.every((p: any) => !UUID.test(p.name ?? '') && !UUID.test(p.sku ?? '')), items.slice(0, 2));
    const page2 = await call('GET', `/fulfillment/accounts/${sellerwix.id}/catalog/products?search=Gildan&page=2&limit=20`);
    check('Provider Product: phân trang server (trang 2 khác trang 1)', page2.status === 200 && !(page2.body?.data?.items ?? []).some((p: any) => productIds.includes(p.id)));
    // Duyệt HẾT các trang (cuộn vô hạn): không trùng, không sót — số id duy nhất phải bằng total.
    const seen = new Set<string>();
    let total = 0;
    for (let page = 1; page <= 50; page += 1) {
      const res = await call('GET', `/fulfillment/accounts/${sellerwix.id}/catalog/products?page=${page}&limit=50`);
      total = res.body?.data?.meta?.total ?? 0;
      const batch = res.body?.data?.items ?? [];
      batch.forEach((p: any) => seen.add(p.id));
      if (batch.length < 50) break;
    }
    check(`Provider Product: duyệt mọi trang ⇒ ${seen.size}/${total} sản phẩm, không trùng không sót`, total > 0 && seen.size === total, { unique: seen.size, total });
    if (mango) {
      const mangoPage = await call('GET', `/fulfillment/accounts/${mango.id}/catalog/products?page=1&limit=20`);
      const mangoIds = (mangoPage.body?.data?.items ?? []).map((p: any) => p.id);
      check('Mango và Sellerwix là hai danh mục RIÊNG', mangoIds.length > 0 && !mangoIds.some((id: string) => productIds.includes(id)));
    }

    // Biến thể ACTIVE thật của sản phẩm Sellerwix đầu tiên có biến thể.
    let picked: { product: any; variant: any } | null = null;
    for (const product of items) {
      const variations = await call('GET', `/fulfillment/accounts/${sellerwix.id}/catalog/products/${product.id}/variations`);
      const active = (variations.body?.data ?? []).find((v: any) => v.status === 'ACTIVE' || v.available !== false);
      if (active) {
        picked = { product, variant: active };
        check('Biến thể có màu / size đọc được (không UUID)', !UUID.test(String(active.color ?? '')) && !UUID.test(String(active.size ?? '')), active);
        break;
      }
    }
    if (!picked) throw new Error('Không tìm được biến thể Sellerwix đang bán');

    console.log('\n▶ 3. Lưu cấu hình sản phẩm Sellerwix cho đơn (ánh xạ TẠM)');
    for (const item of order.items) {
      const res = await call('POST', '/fulfillment/mappings', {
        accountId: sellerwix.id,
        tiktokProductId: item.productId,
        sellerSku: item.sellerSku,
        providerSku: picked.variant.sku,
        providerProductId: picked.product.externalProductId ?? undefined,
        providerVariantId: picked.variant.externalVariantId ?? picked.variant.id ?? undefined,
        providerProductName: picked.product.name,
        providerVariantName: picked.variant.name ?? undefined,
        providerColor: picked.variant.color ?? undefined,
        providerSize: picked.variant.size ?? undefined,
      });
      if (res.body?.data?.id) createdMappingIds.push(res.body.data.id);
      check(`lưu cấu hình Sellerwix cho ${item.sellerSku} ⇒ 201/200`, res.status === 201 || res.status === 200, res.body);
    }
    const after = await call('GET', `/fulfillment/orders/${order.id}/shipping-methods?providerId=${sellerwix.id}`);
    const options = after.body?.data?.options ?? [];
    console.log('    options:', JSON.stringify(options), 'warnings:', JSON.stringify(after.body?.data?.warnings));
    check('Shipping method CÓ dữ liệu thật từ Sellerwix', options.length > 0, after.body?.data);
    check('Nhãn dropdown không chứa UUID / id nội bộ', options.every((o: any) => !UUID.test(o.label) && !String(o.label).includes(sellerwix.id)));
    check('Giá trị gửi đi là `code` của Sellerwix (không phải id DB)', options.every((o: any) => typeof o.value === 'string' && !UUID.test(o.value)));
    const state = await call('GET', `/fulfillment/orders/${order.id}?providerId=${sellerwix.id}`);
    check('State: nhà cung cấp đang đánh giá = Sellerwix', state.body?.data?.provider?.id === sellerwix.id, state.body?.data?.provider);
    if (mango) {
      const mangoShip = await call('GET', `/fulfillment/orders/${order.id}/shipping-methods?providerId=${mango.id}`);
      check('Mango (không có shipping theo đơn) không trả danh sách Sellerwix', !(mangoShip.body?.data?.options ?? []).some((o: any) => options.some((x: any) => x.value === o.value)) || mangoShip.status !== 200);
    }

    console.log('\n▶ 4. Tuỳ chọn loại thông báo');
    await prisma.organizationNotificationPreference.deleteMany({ where: { organizationId: orgId } });
    const def = await call('GET', '/notifications/preferences');
    check('chưa lưu ⇒ mặc định bật cả hai', def.body?.data?.newOrder === true && def.body?.data?.fulfillment === true, def.body);
    const saved = await call('PUT', '/notifications/preferences', { newOrder: false, fulfillment: true });
    check('lưu chỉ Fulfill ⇒ 200', saved.status === 200 && saved.body?.data?.newOrder === false, saved.body);
    const reread = await call('GET', '/notifications/preferences');
    check('đọc lại đúng giá trị đã lưu', reread.body?.data?.newOrder === false && reread.body?.data?.fulfillment === true);
    const bad = await call('PUT', '/notifications/preferences', { newOrder: 'yes' });
    check('dữ liệu sai kiểu ⇒ 400', bad.status === 400, bad.body);
    const sellerTk = sign(seller.id, 'EMPLOYEE');
    const forbidden = await call('PUT', '/notifications/preferences', { newOrder: true, fulfillment: true }, sellerTk);
    check('Seller không có quyền ⇒ 403', forbidden.status === 403, forbidden.status);
  } finally {
    if (createdMappingIds.length) await prisma.fulfillmentProductMapping.deleteMany({ where: { id: { in: createdMappingIds } } });
    await prisma.organizationNotificationPreference.deleteMany({ where: { organizationId: orgId } });
    if (prefBefore) {
      await prisma.organizationNotificationPreference.create({ data: { ...prefBefore } });
    }
    await prisma.user.delete({ where: { id: seller.id } });
    console.log(`\n🧹 Đã xoá ${createdMappingIds.length} ánh xạ tạm, khôi phục tuỳ chọn thông báo.`);
    console.log(`${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }
}

void main();
