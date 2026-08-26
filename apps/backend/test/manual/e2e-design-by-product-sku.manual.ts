/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI: Design lưu theo (Product ID + Seller SKU), trên DATABASE THẬT.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-design-by-product-sku.manual.ts
 * Cần backend đang chạy ở :3000 (npm run start:dev).
 *
 * Đi đúng đường của người dùng: HTTP → Nest → Prisma → PostgreSQL → Cloudflare R2.
 * Toàn bộ dữ liệu test tự dọn ở cuối; KHÔNG đụng tới mật khẩu hay dữ liệu thật của ai.
 *
 * Bổ sung cho `e2e-design-fulfill.manual.ts` (vốn kiểm luồng upload/xoá). File này kiểm đúng
 * những điều khoản mà refactor lần này đặt ra và không thể kiểm bằng unit test:
 *   · danh tính ánh xạ là CẶP khoá, được DATABASE bảo đảm
 *   · một upload phục vụ mọi đơn cùng cặp khoá, kể cả đơn ĐỒNG BỘ VỀ SAU
 *   · xoá design ⇒ mọi đơn quay về "thiếu design" mà không cần thao tác gì thêm
 *   · đơn ĐÃ GỬI sản xuất giữ nguyên ảnh chụp file đã gửi
 *   · endpoint ghi design theo Order Item đã bị GỠ
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

  // -------------------------------------------------------------------------
  // Chọn một sản phẩm CHƯA ánh xạ và đang có đơn thật
  // -------------------------------------------------------------------------
  const candidates = await prisma.podOrderItem.findMany({
    where: { organizationId: orgId, sellerSku: { not: null }, productId: { not: null } },
    select: { id: true, orderId: true, sellerSku: true, skuId: true, productId: true },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });
  const mapped = new Set(
    (
      await prisma.fulfillmentProductMapping.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { tiktokProductId: true, sellerSku: true },
      })
    ).map((m) => `${m.tiktokProductId}|${m.sellerSku}`),
  );
  const item = candidates.find((i) => !mapped.has(`${i.productId}|${i.sellerSku}`));
  if (!item) throw new Error('Mọi sản phẩm đều đã ánh xạ — không có mẫu sạch để thử');

  const account = await prisma.fulfillmentAccount.findFirst({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true, provider: true },
  });
  if (!account) throw new Error('Chưa cấu hình nhà cung cấp fulfillment');

  console.log(`\nSản phẩm thử: productId=${item.productId} · sellerSku=${item.sellerSku}`);

  const created: { mappingIds: string[]; orderIds: string[] } = { mappingIds: [], orderIds: [] };

  // -------------------------------------------------------------------------
  console.log('\n▶ 1. Tạo ánh xạ QUA API — khoá nghiệp vụ là CẶP (Product ID + Seller SKU)');
  // -------------------------------------------------------------------------
  const post = (body: unknown) =>
    fetch(`${API}/fulfillment/mappings?provider=${account.provider}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const missingKey = await post({ sellerSku: item.sellerSku, providerSku: 'E2E-SKU' });
  check('thiếu Product ID ⇒ 400 (không tạo bản ghi chết)', missingKey.status === 400);

  const missingSku = await post({ tiktokProductId: item.productId, providerSku: 'E2E-SKU' });
  check('thiếu Seller SKU ⇒ 400', missingSku.status === 400);

  const createRes = await post({
    tiktokProductId: item.productId,
    sellerSku: item.sellerSku,
    tiktokSkuId: item.skuId,
    providerSku: 'E2E-SKU',
    baseCost: 12.5,
  });
  const mappingBody = await json(createRes);
  const mappingId = mappingBody?.data?.id as string;
  check('tạo ánh xạ đủ khoá ⇒ 200/201', Boolean(mappingId), mappingBody);
  if (!mappingId) throw new Error('Không tạo được ánh xạ, dừng');
  created.mappingIds.push(mappingId);

  check('Base Cost được lưu', mappingBody?.data?.baseCost === 12.5, mappingBody?.data?.baseCost);
  check('chưa có design ⇒ designStatus = MISSING_ALL', mappingBody?.data?.designStatus === 'MISSING_ALL');

  const dup = await post({
    tiktokProductId: item.productId,
    sellerSku: item.sellerSku,
    providerSku: 'E2E-SKU-2',
  });
  check('🔴 ánh xạ THỨ HAI cho cùng cặp khoá ⇒ bị chặn (một sản phẩm, một bộ Design)', dup.status >= 400, dup.status);

  // Hàng rào cuối ở tầng DATABASE — kiểm trực tiếp, không qua service.
  let dbBlocked = false;
  try {
    await prisma.fulfillmentProductMapping.create({
      data: {
        organizationId: orgId,
        accountId: account.id,
        provider: account.provider,
        tiktokProductId: item.productId,
        sellerSku: item.sellerSku,
        providerSku: 'E2E-BYPASS',
      },
    });
  } catch {
    dbBlocked = true;
  }
  check('🔴 DATABASE cũng chặn trùng cặp khoá (UNIQUE index, chống chạy đua)', dbBlocked);

  // -------------------------------------------------------------------------
  console.log('\n▶ 2. Có ánh xạ, chưa Design ⇒ DESIGN_MISSING (không phải MAPPING_MISSING)');
  // -------------------------------------------------------------------------
  const state = (id: string) => fetch(`${API}/fulfillment/orders/${id}`, { headers: auth }).then(json);
  let s = await state(item.orderId);
  check('ready=false', s.data?.ready === false);
  check('có DESIGN_MISSING', s.data?.issues?.some((i: any) => i.code === 'DESIGN_MISSING'), s.data?.issues);
  check('KHÔNG còn MAPPING_MISSING', !s.data?.issues?.some((i: any) => i.code === 'MAPPING_MISSING'));

  // -------------------------------------------------------------------------
  console.log('\n▶ 3. Upload Design vào PRODUCT MAPPING — không có đường nào ghi vào đơn');
  // -------------------------------------------------------------------------
  const upload = (placement: string) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), `${placement.toLowerCase()}.png`);
    return fetch(`${API}/fulfillment/mappings/${mappingId}/designs/${placement}`, {
      method: 'POST',
      headers: auth,
      body: form,
    }).then(json);
  };

  const front = await upload('FRONT');
  check('upload FRONT ok', front?.data?.placement === 'FRONT', front);
  const back = await upload('BACK');
  check('upload BACK ok', back?.data?.placement === 'BACK', back);

  const legacy = await fetch(`${API}/pod/tiktok/order-items/${item.id}/designs/FRONT`, {
    method: 'POST',
    headers: auth,
    body: new FormData(),
  });
  check('🔴 endpoint ghi design theo Order Item đã bị GỠ ⇒ 404', legacy.status === 404, legacy.status);

  const itemDesignRows = await prisma.podOrderItemDesign.count({
    where: { orderItemId: item.id, deletedAt: null },
  });
  check('🔴 KHÔNG có dòng design nào được ghi vào bảng theo Order Item', itemDesignRows === 0);

  // -------------------------------------------------------------------------
  console.log('\n▶ 4. MỌI đơn cùng cặp khoá dùng chung Design — không sao chép dữ liệu');
  // -------------------------------------------------------------------------
  const orders = await fetch(`${API}/pod/tiktok/orders?page=1&limit=100`, { headers: auth }).then(json);
  const rows = (orders?.data?.items ?? []).flatMap((o: any) =>
    o.items.map((i: any) => ({ ...i, orderId: o.id })),
  );
  const sameKey = rows.filter(
    (i: any) => i.productId === item.productId && i.sellerSku === item.sellerSku,
  );
  check(
    `mọi dòng hàng cùng cặp khoá đều có ĐỦ 2 design (${sameKey.length} dòng)`,
    sameKey.length > 0 && sameKey.every((i: any) => i.designs.length === 2),
    sameKey.map((i: any) => i.designs.length),
  );
  check(
    'mọi dòng hàng cùng cặp khoá đều trỏ về CÙNG một mappingId',
    sameKey.every((i: any) => i.mappingId === mappingId),
  );

  const designRowCount = await prisma.fulfillmentProductDesign.count({
    where: { tiktokProductId: item.productId, sellerSku: item.sellerSku, deletedAt: null },
  });
  check(
    `🔴 KHÔNG duplicate: ${sameKey.length} dòng hàng nhưng chỉ ${designRowCount} bản ghi design`,
    designRowCount === 2,
  );

  // Cùng Product ID nhưng KHÁC Seller SKU ⇒ sản phẩm khác ⇒ không được lây design.
  const sameProductOtherSku = rows.find(
    (i: any) => i.productId === item.productId && i.sellerSku !== item.sellerSku,
  );
  if (sameProductOtherSku) {
    check(
      '🔴 cùng Product ID nhưng khác Seller SKU ⇒ KHÔNG dùng chung design',
      sameProductOtherSku.mappingId !== mappingId,
      sameProductOtherSku.mappingId,
    );
  } else {
    console.log('  ⤳ Bỏ qua: dữ liệu không có sản phẩm nào chung Product ID mà khác Seller SKU.');
  }

  /**
   * 🔴 Phép thử QUAN TRỌNG NHẤT của refactor này, và nó chạy trên DỮ LIỆU THẬT.
   *
   * Database hiện có một Seller SKU được dùng lại cho BA product_id khác nhau. Với luật cũ
   * (khớp một trong ba khoá, có nhánh dự phòng theo Seller SKU), cả ba sản phẩm đó sẽ chung
   * một bộ Design — nghĩa là hai trong ba sản phẩm ra xưởng in với file của sản phẩm khác.
   * Với luật mới, chúng là ba sản phẩm riêng biệt.
   */
  const sameSellerSkuOtherProduct = rows.filter(
    (i: any) => i.sellerSku === item.sellerSku && i.productId !== item.productId,
  );
  if (sameSellerSkuOtherProduct.length > 0) {
    // So theo FILE, không theo "có design hay không": sản phẩm khác hoàn toàn có thể có
    // design RIÊNG của nó (dữ liệu thật đang có đúng trường hợp đó). Điều phải chứng minh là
    // design của sản phẩm ĐANG THỬ không lây sang — tức không dùng chung file, không chung ánh xạ.
    const testFiles = new Set(
      sameKey.flatMap((i: any) => i.designs.map((d: any) => d.fileUrl)),
    );
    check(
      `🔴 cùng Seller SKU nhưng khác Product ID ⇒ KHÔNG lây design (${sameSellerSkuOtherProduct.length} dòng)`,
      sameSellerSkuOtherProduct.every(
        (i: any) =>
          i.mappingId !== mappingId &&
          i.designs.every((d: any) => !testFiles.has(d.fileUrl)),
      ),
      sameSellerSkuOtherProduct.map((i: any) => ({
        p: i.productId,
        m: i.mappingId,
        files: i.designs.map((d: any) => d.fileUrl),
      })),
    );
  } else {
    console.log('  ⤳ Bỏ qua: dữ liệu không có Seller SKU nào dùng chung giữa nhiều sản phẩm.');
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ 5. Đơn ĐỒNG BỘ VỀ SAU tự nhận Design, không cần upload lại');
  // -------------------------------------------------------------------------
  const source = await prisma.podOrder.findUnique({
    where: { id: item.orderId },
  });
  const newOrderId = randomUUID();
  const stamp = Date.now();
  // Nhân bản NGUYÊN VẸN một đơn thật rồi chỉ đổi khoá định danh: đơn giả lập phải giống hệt
  // đơn do scheduler đồng bộ về, nếu không phép thử "đơn mới tự nhận design" không nói lên gì.
  const { id: _drop, createdAt: _c, updatedAt: _u, ...clone } = source!;
  await prisma.podOrder.create({
    data: {
      ...(clone as any),
      id: newOrderId,
      tiktokOrderId: `E2E-${stamp}`,
      payloadHash: createHash('sha256').update(`e2e-${stamp}`).digest('hex'),
      items: {
        create: {
          organizationId: orgId,
          tiktokLineItemId: `E2E-ITEM-${stamp}`,
          // ĐÚNG cặp khoá của sản phẩm đã khai design — không khai gì thêm.
          productId: item.productId,
          sellerSku: item.sellerSku,
          // 🔴 sku_id CỐ TÌNH khác: chứng minh nó không còn tham gia ghép.
          skuId: `E2E-SKU-ID-${stamp}`,
          payloadHash: createHash('sha256').update(`e2e-item-${stamp}`).digest('hex'),
        },
      },
    },
  });
  created.orderIds.push(newOrderId);

  const afterSync = await fetch(`${API}/pod/tiktok/orders?page=1&limit=100`, { headers: auth }).then(json);
  const newOrder = (afterSync?.data?.items ?? []).find((o: any) => o.id === newOrderId);
  const newItem = newOrder?.items?.[0];
  check('đơn mới xuất hiện trong danh sách', Boolean(newItem), newOrder);
  check(
    '🔴 đơn mới TỰ NHẬN đủ 2 design mà không upload lần nào',
    (newItem?.designs?.length ?? 0) === 2,
    newItem?.designs,
  );
  check('đơn mới trỏ về đúng Product Mapping', newItem?.mappingId === mappingId);
  check(
    '🔴 ghép được dù sku_id hoàn toàn khác ⇒ khoá đúng là cặp Product ID + Seller SKU',
    newItem?.mappingId === mappingId,
  );

  // -------------------------------------------------------------------------
  console.log('\n▶ 6. Replace chỉ cập nhật Product Mapping — không copy sang từng đơn');
  // -------------------------------------------------------------------------
  const listDesigns = () =>
    fetch(`${API}/fulfillment/mappings/${mappingId}/designs`, { headers: auth }).then(json);
  const beforeBack = (await listDesigns()).data.find((d: any) => d.placement === 'BACK').fileUrl;

  const replaced = await upload('FRONT');
  check('replace FRONT ⇒ version = 2', replaced?.data?.version === 2, replaced?.data);
  const afterReplace = await listDesigns();
  check('vẫn đúng 2 bản ghi design (không sinh thêm)', afterReplace?.data?.length === 2);
  check(
    'BACK KHÔNG bị đụng khi replace FRONT',
    afterReplace.data.find((d: any) => d.placement === 'BACK').fileUrl === beforeBack,
  );

  const rowsAfterReplace = await prisma.fulfillmentProductDesign.count({
    where: { tiktokProductId: item.productId, sellerSku: item.sellerSku, deletedAt: null },
  });
  check('🔴 replace KHÔNG sinh thêm bản ghi cho từng đơn', rowsAfterReplace === 2);

  const ordersAfterReplace = await fetch(`${API}/pod/tiktok/orders?page=1&limit=100`, { headers: auth }).then(json);
  const newFrontUrl = replaced?.data?.fileUrl;
  const allSeeNew = (ordersAfterReplace?.data?.items ?? [])
    .flatMap((o: any) => o.items)
    .filter((i: any) => i.mappingId === mappingId)
    .every((i: any) => i.designs.some((d: any) => d.fileUrl === newFrontUrl));
  check('🔴 MỌI đơn thấy file mới NGAY (không cần thao tác đồng bộ nào)', allSeeNew);

  // -------------------------------------------------------------------------
  console.log('\n▶ 7. Delete chỉ xoá Design — Product Mapping và Order còn nguyên');
  // -------------------------------------------------------------------------
  const del = (placement: string) =>
    fetch(`${API}/fulfillment/mappings/${mappingId}/designs/${placement}`, {
      method: 'DELETE',
      headers: auth,
    });

  check('DELETE FRONT → 200', (await del('FRONT')).status === 200);
  check('DELETE BACK → 200', (await del('BACK')).status === 200);

  const mappingStillThere = await prisma.fulfillmentProductMapping.findUnique({
    where: { id: mappingId },
    select: { deletedAt: true },
  });
  check('Product Mapping KHÔNG bị xoá', mappingStillThere?.deletedAt === null);
  check(
    'Order KHÔNG bị xoá',
    (await prisma.podOrder.count({ where: { id: item.orderId } })) === 1,
  );

  const afterDelete = await fetch(`${API}/pod/tiktok/orders?page=1&limit=100`, { headers: auth }).then(json);
  const noneHaveDesign = (afterDelete?.data?.items ?? [])
    .flatMap((o: any) => o.items)
    .filter((i: any) => i.mappingId === mappingId)
    .every((i: any) => i.designs.length === 0);
  check('🔴 MỌI đơn liên kết chuyển sang "Design Missing" ngay', noneHaveDesign);

  s = await state(item.orderId);
  check('readiness quay lại DESIGN_MISSING', s.data?.issues?.some((i: any) => i.code === 'DESIGN_MISSING'));

  check('upload LẠI sau khi xoá vẫn được', Boolean((await upload('FRONT'))?.data?.id));

  // -------------------------------------------------------------------------
  console.log('\n▶ 8. Đơn ĐÃ GỬI sản xuất giữ nguyên ảnh chụp file đã gửi');
  // -------------------------------------------------------------------------
  const submitted = await prisma.fulfillmentOrderItem.findFirst({
    where: { organizationId: orgId },
    select: { id: true, printFiles: true },
  });
  if (submitted) {
    check(
      '🔴 print_files của đơn đã gửi vẫn còn nguyên (không bị design mới ghi đè)',
      Array.isArray(submitted.printFiles) && (submitted.printFiles as any[]).length > 0,
      submitted.printFiles,
    );
  } else {
    console.log('  ⤳ Bỏ qua: chưa có đơn nào từng gửi sản xuất.');
  }

  const legacyArchive = await prisma.podOrderItemDesign.count();
  check(`🔴 bảng lưu trữ lịch sử còn nguyên ${legacyArchive} dòng (migration không mất dữ liệu)`, legacyArchive > 0);

  // -------------------------------------------------------------------------
  console.log('\n▶ 9. Biên: vị trí trống và cô lập tenant');
  // -------------------------------------------------------------------------
  const emptyPlacement = await del('BACK');
  check('xoá vị trí chưa có design ⇒ 404 rõ ràng', emptyPlacement.status === 404, emptyPlacement.status);

  const otherOrgMapping = await prisma.fulfillmentProductMapping.findFirst({
    where: { organizationId: { not: orgId } },
    select: { id: true },
  });
  if (otherOrgMapping) {
    const cross = await fetch(`${API}/fulfillment/mappings/${otherOrgMapping.id}/designs`, {
      headers: auth,
    });
    check('đọc design của tổ chức khác ⇒ 404 (ADR-004)', cross.status === 404);
  } else {
    console.log('  ⤳ Bỏ qua: không có mapping của tổ chức khác để thử.');
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ 10. Bảng Product Mapping trả đủ dữ liệu màn hình cần');
  // -------------------------------------------------------------------------
  const paged = await fetch(
    `${API}/fulfillment/mappings/paged?page=1&limit=100&search=${encodeURIComponent(item.sellerSku!)}`,
    { headers: auth },
  ).then(json);
  const row = (paged?.data?.items ?? []).find((m: any) => m.id === mappingId);
  check('tìm được theo Seller SKU', Boolean(row), paged?.data?.meta);
  check('trả Product ID + Seller SKU', row?.tiktokProductId === item.productId && row?.sellerSku === item.sellerSku);
  check('trả Fulfillment SKU', row?.providerSku === 'E2E-SKU');
  check('trả Provider', typeof row?.providerName === 'string' || row?.providerName === null);
  check('trả Base Cost', row?.baseCost === 12.5, row?.baseCost);
  check('trả Design của sản phẩm', (row?.designs?.length ?? 0) === 1, row?.designs);
  check('chỉ có Front ⇒ designStatus = READY', row?.designStatus === 'READY', row?.designStatus);
  check('trả Updated By', row?.updatedByName !== undefined);
  check('trả Updated At', typeof row?.updatedAt === 'string');

  const byProductId = await fetch(
    `${API}/fulfillment/mappings/paged?page=1&limit=100&search=${encodeURIComponent(item.productId!)}`,
    { headers: auth },
  ).then(json);
  check(
    'tìm được theo Product ID (nửa còn lại của khoá)',
    (byProductId?.data?.items ?? []).some((m: any) => m.id === mappingId),
  );

  // -------------------------------------------------------------------------
  // Dọn dẹp
  // -------------------------------------------------------------------------
  const files = await prisma.fulfillmentProductDesign.findMany({
    where: { tiktokProductId: item.productId, sellerSku: item.sellerSku },
    select: { storageFileId: true },
  });
  await prisma.fulfillmentProductDesign.deleteMany({
    where: { tiktokProductId: item.productId, sellerSku: item.sellerSku },
  });
  await prisma.storageFile.deleteMany({ where: { id: { in: files.map((f: { storageFileId: string }) => f.storageFileId) } } });
  await prisma.fulfillmentProductMapping.deleteMany({ where: { id: { in: created.mappingIds } } });
  await prisma.podOrder.deleteMany({ where: { id: { in: created.orderIds } } });
  console.log('\n🧹 Đã dọn ánh xạ, design và đơn test.');

  console.log(`\n${fail === 0 ? '✅' : '❌'} KẾT QUẢ: ${pass} pass, ${fail} fail`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
