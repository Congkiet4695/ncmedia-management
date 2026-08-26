/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI cho sprint sửa lỗi POD Orders, trên DATABASE THẬT.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-design-independent.manual.ts
 * Cần backend đang chạy ở :3000 (npm run start:dev).
 *
 * Phạm vi (mục §3 và §4 của yêu cầu — hai mục có phần backend):
 *   · Design và Product Mapping ĐỘC LẬP: upload trước/ánh xạ sau, và ngược lại.
 *   · Xoá ánh xạ KHÔNG làm mất design (lỗi cascade của mô hình cũ).
 *   · Thẻ thống kê lọc theo CÙNG điều kiện với danh sách.
 *
 * (§1 modal scroll và §2 preview ảnh là hành vi thuần giao diện — không kiểm được ở đây;
 *  xem phần "Kết quả test" trong báo cáo.)
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối.
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:3000/api/v1';
/** PNG 1×1 hợp lệ — đủ để đi qua kiểm tra mime/định dạng thật của Storage Module. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
  const admin = await prisma.user.findFirst({
    where: { organization: { slug: 'ncmedia' }, role: { code: 'ADMIN' }, deletedAt: null },
    select: { id: true, organizationId: true, role: { select: { code: true } } },
  });
  if (!admin) throw new Error('Không tìm thấy admin của tổ chức giữ dữ liệu đơn');
  const orgId = admin.organizationId;

  const token = jwt.sign(
    { sub: admin.id, organizationId: orgId, role: admin.role.code, jti: randomUUID() },
    process.env.JWT_ACCESS_SECRET as string,
    { algorithm: 'HS256', expiresIn: 900 },
  );
  const auth = { Authorization: `Bearer ${token}` };
  const json = (r: Response) => r.json() as any;
  const get = (path: string) => fetch(`${API}${path}`, { headers: auth }).then(json);

  // Cặp khoá THỬ NGHIỆM, không đụng sản phẩm thật nào.
  const KEY = { tiktokProductId: `E2E-P-${Date.now()}`, sellerSku: `E2E-SKU-${Date.now()}` };
  const qs = `tiktokProductId=${encodeURIComponent(KEY.tiktokProductId)}&sellerSku=${encodeURIComponent(KEY.sellerSku)}`;

  const uploadDesign = (placement: string) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), `${placement.toLowerCase()}.png`);
    return fetch(`${API}/fulfillment/product-designs/${placement}?${qs}`, {
      method: 'POST',
      headers: auth,
      body: form,
    }).then(json);
  };
  const listDesigns = () => get(`/fulfillment/product-designs?${qs}`);
  const deleteDesign = (placement: string) =>
    fetch(`${API}/fulfillment/product-designs/${placement}?${qs}`, {
      method: 'DELETE',
      headers: auth,
    });

  const cleanup: { orderIds: string[]; mappingIds: string[] } = { orderIds: [], mappingIds: [] };

  try {
    // -------------------------------------------------------------------------
    console.log('\n▶ 1. Upload Design KHI CHƯA CÓ Product Mapping');
    // -------------------------------------------------------------------------
    const noMapping = await prisma.fulfillmentProductMapping.count({
      where: { organizationId: orgId, ...KEY, deletedAt: null },
    });
    check('sản phẩm thử CHƯA có ánh xạ nào', noMapping === 0);

    const front = await uploadDesign('FRONT');
    check('🔴 upload FRONT thành công dù CHƯA ánh xạ', front?.data?.placement === 'FRONT', front);
    check('version = 1 ở lần đầu', front?.data?.version === 1);
    check('có fileUrl dùng được', String(front?.data?.fileUrl ?? '').length > 0);

    const back = await uploadDesign('BACK');
    check('upload BACK cũng không cần ánh xạ', back?.data?.placement === 'BACK', back);

    const listed = await listDesigns();
    check('đọc lại đủ 2 vị trí', listed?.data?.length === 2, listed?.data?.map((d: any) => d.placement));

    const rowsInDb = await prisma.fulfillmentProductDesign.findMany({
      where: { organizationId: orgId, ...KEY, deletedAt: null },
    });
    check('🔴 design lưu theo CẶP KHOÁ sản phẩm', rowsInDb.length === 2);
    check(
      '🔴 bảng design KHÔNG còn cột mapping_id',
      !Object.prototype.hasOwnProperty.call(rowsInDb[0] ?? {}, 'mappingId'),
      Object.keys(rowsInDb[0] ?? {}),
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 2. Ánh xạ SAU — design đã có vẫn nguyên vẹn');
    // -------------------------------------------------------------------------
    const account = await prisma.fulfillmentAccount.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, provider: true },
    });
    if (!account) throw new Error('Chưa cấu hình nhà cung cấp fulfillment');

    const created = await fetch(`${API}/fulfillment/mappings?provider=${account.provider}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: account.id,
        ...KEY,
        providerSku: 'E2E-PROVIDER-SKU',
        baseCost: 4.5,
      }),
    }).then(json);
    const mappingId = created?.data?.id as string;
    check('tạo ánh xạ SAU khi đã có design ⇒ thành công', Boolean(mappingId), created);
    if (mappingId) cleanup.mappingIds.push(mappingId);

    const afterMapping = await listDesigns();
    check('🔴 design KHÔNG bị ảnh hưởng khi ánh xạ được tạo', afterMapping?.data?.length === 2);
    check(
      'màn hình Product Mapping thấy đúng design của sản phẩm',
      created?.data?.designStatus === 'READY',
      created?.data?.designStatus,
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 3. XOÁ ánh xạ KHÔNG làm mất design (lỗi cascade của mô hình cũ)');
    // -------------------------------------------------------------------------
    const del = await fetch(`${API}/fulfillment/mappings/${mappingId}`, {
      method: 'DELETE',
      headers: auth,
    });
    check('xoá ánh xạ thành công', del.status === 200 || del.status === 204, del.status);

    const afterDelete = await listDesigns();
    check(
      '🔴 design VẪN CÒN sau khi xoá ánh xạ (trước đây bị CASCADE xoá theo)',
      afterDelete?.data?.length === 2,
      afterDelete?.data,
    );

    // Khai lại ánh xạ để phần dọn dẹp bên dưới có bản ghi để xoá.
    const recreated = await fetch(`${API}/fulfillment/mappings?provider=${account.provider}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: account.id,
        ...KEY,
        providerSku: 'E2E-PROVIDER-SKU-2',
      }),
    }).then(json);
    if (recreated?.data?.id) cleanup.mappingIds.push(recreated.data.id);
    check(
      '🔴 ánh xạ lại sản phẩm đó ⇒ design cũ TỰ ĐỘNG dùng lại được',
      recreated?.data?.designStatus === 'READY',
      recreated?.data?.designStatus,
    );

    // -------------------------------------------------------------------------
    console.log('\n▶ 4. Replace / Delete từng vị trí — độc lập với nhau');
    // -------------------------------------------------------------------------
    const replaced = await uploadDesign('FRONT');
    check('replace FRONT ⇒ version = 2', replaced?.data?.version === 2, replaced?.data);
    const stillTwo = await listDesigns();
    check('vẫn đúng 2 bản ghi (không sinh thêm)', stillTwo?.data?.length === 2);
    check(
      'BACK không bị đụng khi replace FRONT',
      stillTwo?.data?.find((d: any) => d.placement === 'BACK')?.version === 1,
    );

    check('xoá FRONT → 200', (await deleteDesign('FRONT')).status === 200);
    const onlyBack = await listDesigns();
    check('chỉ còn BACK', onlyBack?.data?.length === 1 && onlyBack.data[0].placement === 'BACK');
    check('xoá vị trí trống ⇒ 404 rõ ràng', (await deleteDesign('FRONT')).status === 404);
    check('upload lại sau khi xoá vẫn được', Boolean((await uploadDesign('FRONT'))?.data?.id));

    // -------------------------------------------------------------------------
    console.log('\n▶ 5. Thiếu khoá ⇒ từ chối rõ ràng, không tạo dữ liệu chết');
    // -------------------------------------------------------------------------
    const noKey = await fetch(
      `${API}/fulfillment/product-designs?tiktokProductId=${KEY.tiktokProductId}`,
      { headers: auth },
    );
    check('đọc design thiếu Seller SKU ⇒ 400', noKey.status === 400, noKey.status);

    // -------------------------------------------------------------------------
    console.log('\n▶ 6. Đơn hàng ĐỌC design theo cặp khoá, không qua ánh xạ');
    // -------------------------------------------------------------------------
    const source = await prisma.podOrder.findFirst({ where: { organizationId: orgId } });
    if (!source) throw new Error('Không có đơn mẫu để nhân bản');
    const { id: _d, createdAt: _c, updatedAt: _u, ...clone } = source as any;
    const orderId = randomUUID();
    const stamp = `${Date.now()}`;
    await prisma.podOrder.create({
      data: {
        ...clone,
        id: orderId,
        tiktokOrderId: `E2E-IND-${stamp}`,
        payloadHash: createHash('sha256').update(stamp).digest('hex'),
        items: {
          create: {
            organizationId: orgId,
            tiktokLineItemId: `E2E-IND-ITEM-${stamp}`,
            productId: KEY.tiktokProductId,
            sellerSku: KEY.sellerSku,
            skuId: `E2E-SKUID-${stamp}`,
            payloadHash: createHash('sha256').update(`item-${stamp}`).digest('hex'),
          },
        },
      },
    });
    cleanup.orderIds.push(orderId);

    const detail = await get(`/pod/tiktok/orders/${orderId}`);
    const orderItem = detail?.data?.items?.[0];
    check('🔴 đơn thấy đủ design của sản phẩm', (orderItem?.designs?.length ?? 0) === 2, orderItem?.designs?.length);
    check('đơn mang mappingId vì sản phẩm đã ánh xạ lại', Boolean(orderItem?.mappingId));

    // Bỏ ánh xạ, đơn vẫn phải thấy design.
    await prisma.fulfillmentProductMapping.updateMany({
      where: { organizationId: orgId, ...KEY },
      data: { deletedAt: new Date() },
    });
    const afterUnmap = await get(`/pod/tiktok/orders/${orderId}`);
    const unmappedItem = afterUnmap?.data?.items?.[0];
    check(
      '🔴 gỡ ánh xạ ⇒ đơn VẪN thấy design (hai trục độc lập)',
      (unmappedItem?.designs?.length ?? 0) === 2,
      unmappedItem?.designs?.length,
    );
    check('gỡ ánh xạ ⇒ mappingId = null', unmappedItem?.mappingId === null);

    // -------------------------------------------------------------------------
    console.log('\n▶ 7. Thẻ thống kê lọc theo CÙNG điều kiện với danh sách');
    // -------------------------------------------------------------------------
    const globalStats = await get('/pod/tiktok/orders/stats');
    const globalList = await get('/pod/tiktok/orders?page=1&limit=1');
    check(
      'không lọc ⇒ tổng của thẻ = tổng của danh sách',
      globalStats?.data?.total === globalList?.data?.meta?.total,
      { stats: globalStats?.data?.total, list: globalList?.data?.meta?.total },
    );

    /** So thẻ và danh sách dưới CÙNG một bộ lọc — đây là chính điều §4 yêu cầu. */
    const compare = async (label: string, filter: string) => {
      const [stats, list] = await Promise.all([
        get(`/pod/tiktok/orders/stats?${filter}`),
        get(`/pod/tiktok/orders?page=1&limit=1&${filter}`),
      ]);
      check(
        `${label}: thẻ Total = tổng danh sách (${stats?.data?.total} = ${list?.data?.meta?.total})`,
        stats?.data?.total === list?.data?.meta?.total,
        { filter, stats: stats?.data, listTotal: list?.data?.meta?.total },
      );
      return stats?.data;
    };

    const completedStats = await compare('lọc theo trạng thái', 'status=COMPLETED');
    check(
      '🔴 lọc COMPLETED ⇒ thẻ chỉ đếm COMPLETED, không còn số liệu toàn hệ thống',
      Object.keys(completedStats?.byStatus ?? {}).every((s) => s === 'COMPLETED'),
      completedStats?.byStatus,
    );

    await compare('lọc theo khoảng ngày', 'datePreset=LAST_7_DAYS');
    await compare('lọc theo kết nối', `accountId=${source.accountId}`);
    await compare('lọc sản phẩm POD', 'hasPodItem=true');
    await compare('tìm kiếm', `search=${encodeURIComponent('E2E-IND-')}`);
    await compare('kết hợp nhiều bộ lọc', `datePreset=LAST_30_DAYS&hasPodItem=true`);

    const narrow = await get(
      `/pod/tiktok/orders/stats?search=${encodeURIComponent(`E2E-IND-${stamp}`)}`,
    );
    check(
      '🔴 lọc tới đúng MỘT đơn ⇒ thẻ báo đúng 1 (không phải tổng toàn hệ thống)',
      narrow?.data?.total === 1,
      narrow?.data,
    );
  } finally {
    // -------------------------------------------------------------------------
    // Dọn dẹp
    // -------------------------------------------------------------------------
    const files = await prisma.fulfillmentProductDesign.findMany({
      where: { organizationId: orgId, tiktokProductId: KEY.tiktokProductId },
      select: { storageFileId: true },
    });
    await prisma.fulfillmentProductDesign.deleteMany({
      where: { organizationId: orgId, tiktokProductId: KEY.tiktokProductId },
    });
    await prisma.storageFile.deleteMany({
      where: { id: { in: files.map((f: { storageFileId: string }) => f.storageFileId) } },
    });
    await prisma.fulfillmentProductMapping.deleteMany({
      where: { organizationId: orgId, tiktokProductId: KEY.tiktokProductId },
    });
    await prisma.fulfillmentMappingCandidate.deleteMany({
      where: { organizationId: orgId, tiktokProductId: KEY.tiktokProductId },
    });
    await prisma.podOrder.deleteMany({ where: { id: { in: cleanup.orderIds } } });
    console.log('\n🧹 Đã dọn design, ánh xạ và đơn test.');

    console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  }
}

void main();
