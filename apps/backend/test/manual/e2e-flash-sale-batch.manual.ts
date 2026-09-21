/* eslint-disable */
/**
 * Kiểm thử ĐẦU-CUỐI **Batch Update Flash Sale** với 3.107 SKU thật, trên DATABASE THẬT + HTTP THẬT.
 *
 * Chạy:  API=http://localhost:3010/api/v1 node -r ts-node/register -r dotenv/config test/manual/e2e-flash-sale-batch.manual.ts
 * Cần backend đang chạy (mặc định :3000). KHÔNG gọi TikTok: Batch Update chỉ ghi database
 * (đợt sale ở DRAFT, không publish). Đợt sale thử nghiệm được tạo mới và XOÁ ở cuối.
 *
 * Kịch bản bám đúng lỗi đã gặp: chọn 3.107 dòng → Batch edit → Discount 30% → "Internal server error".
 */
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = process.env.API ?? 'http://localhost:3000/api/v1';
const TARGET = Number(process.env.SKU_COUNT ?? 3107);

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

async function call(token: string, method: string, path: string, body?: unknown) {
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body: json, data: json?.data, ms: Date.now() - t0 };
}

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirst({ where: { slug: 'ncmedia', deletedAt: null }, select: { id: true } });
  if (!org) throw new Error('Không có Organization ncmedia');
  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, deletedAt: null, role: { code: 'ADMIN' } },
    select: { id: true },
  });
  if (!admin) throw new Error('Không có ADMIN của ncmedia');
  const shop = await prisma.podTiktokShop.findFirst({ where: { organizationId: org.id, deletedAt: null }, select: { id: true } });
  if (!shop) throw new Error('Không có shop');

  const token = jwt.sign(
    { sub: admin.id, organizationId: org.id, role: 'ADMIN', jti: randomUUID() },
    process.env.JWT_ACCESS_SECRET as string,
    { algorithm: 'HS256', expiresIn: 3600 },
  );

  // Lấy đủ TARGET biến thể thật của shop (sản phẩm ACTIVATE có giá).
  const variants = await prisma.podProductVariant.findMany({
    where: { deletedAt: null, product: { shopId: shop.id, deletedAt: null } },
    select: { id: true, productId: true, salePrice: true, listPrice: true },
    take: TARGET,
    orderBy: { createdAt: 'asc' },
  });
  if (variants.length < TARGET) throw new Error(`Chỉ có ${variants.length} biến thể, cần ${TARGET}`);

  console.log(`\n▶ 1. Tạo đợt sale thử nghiệm (DRAFT) + thêm ${TARGET} SKU`);
  const start = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 6 * 3600 * 1000);
  const created = await call(token, 'POST', '/pod/flash-sales', {
    shopId: shop.id,
    name: `[TEST] batch ${TARGET}`.slice(0, 50),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    productLevel: 'VARIATION',
  });
  check('POST /pod/flash-sales → 201/200', created.status === 201 || created.status === 200, created.body);
  const id = created.data?.id as string;

  try {
    for (const part of chunk(variants, 1000)) {
      const add = await call(token, 'POST', `/pod/flash-sales/${id}/items`, {
        items: part.map((v) => ({ productId: v.productId, variantId: v.id })),
      });
      check(`POST items ×${part.length} → 200/201 (${add.ms}ms)`, add.status < 300, add.body);
    }
    const items = await prisma.podFlashSaleItem.findMany({
      where: { flashSaleId: id },
      select: { id: true, originalPrice: true },
      orderBy: { sortOrder: 'asc' },
    });
    check(`đợt sale có đúng ${TARGET} dòng`, items.length === TARGET, items.length);
    const ids = items.map((i) => i.id);

    console.log(`\n▶ 2. 🔴 Tái hiện lỗi cũ: MỘT request mang cả ${TARGET} id (${JSON.stringify(ids).length} byte)`);
    const big = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids, discountPercent: 30 });
    check('không còn 500 INTERNAL_ERROR', big.status !== 500 && big.body?.code !== 'INTERNAL_ERROR', big.body);
    // Body ~121 KB nay nằm dưới trần 1 MB ⇒ tới được validator: 3.107 > 1.000 id/request ⇒ 400 rõ ràng.
    check('trả 400 VALIDATION_ERROR rõ ràng (trần 1.000 id/request)', big.status === 400 && big.body?.code === 'VALIDATION_ERROR', big.body);
    const huge = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids, discountPercent: 30, padding: 'x'.repeat(1_100_000) });
    check('body > 1 MB ⇒ 413 PAYLOAD_TOO_LARGE, không phải 500', huge.status === 413 && huge.body?.code === 'PAYLOAD_TOO_LARGE', huge.body);

    console.log(`\n▶ 3. Batch edit ${TARGET} SKU · Discount 30% — chia lượt như giao diện (≤ 1.000 id/request)`);
    const t0 = Date.now();
    const merged = { requested: 0, updated: 0, skipped: 0, failures: [] as any[] };
    for (const part of chunk(ids, 1000)) {
      const r = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: part, discountPercent: 30 });
      check(`PATCH batch ×${part.length} → 200 (${r.ms}ms)`, r.status === 200, r.body);
      const b = r.data?.batchResult ?? {};
      merged.requested += b.requested ?? 0;
      merged.updated += b.updated ?? 0;
      merged.skipped += b.skipped ?? 0;
      merged.failures.push(...(b.failures ?? []));
    }
    console.log(`  tổng ${Date.now() - t0}ms · requested=${merged.requested} updated=${merged.updated} skipped=${merged.skipped}`);
    check(`updated + skipped = ${TARGET}`, merged.updated + merged.skipped === TARGET, merged);
    if (merged.skipped > 0) console.log('  lý do bỏ qua (mẫu):', merged.failures.slice(0, 3));

    const after = await prisma.podFlashSaleItem.findMany({
      where: { flashSaleId: id },
      select: { id: true, originalPrice: true, flashSalePrice: true, discountPercent: true, status: true },
    });
    const wrong = after.filter((row) => {
      if (!row.originalPrice || row.originalPrice.lte(0)) return false; // dòng bỏ qua
      const expected = row.originalPrice.mul(70).div(100).toDecimalPlaces(2);
      return !row.flashSalePrice.equals(expected);
    });
    check('🔴 mọi dòng có giá gốc: dealPrice = retail × 0,7 (làm tròn 2 chữ số)', wrong.length === 0, wrong.slice(0, 3));
    const skippedRows = after.filter((row) => !row.originalPrice || row.originalPrice.lte(0)).length;
    check('số dòng bỏ qua == số dòng không có giá gốc hợp lệ', skippedRows === merged.skipped, { skippedRows, merged: merged.skipped });

    console.log('\n▶ 4. Các cỡ / chế độ khác');
    for (const n of [1, 10, 100, 500, 1000]) {
      const r = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, n), discountPercent: 1 });
      check(`${n} SKU · giảm 1% → 200 (${r.ms}ms), updated=${r.data?.batchResult?.updated}`, r.status === 200 && r.data?.batchResult?.requested === n, r.body);
    }
    const p99 = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 50), discountPercent: 99 });
    check('giảm 99% → 200', p99.status === 200, p99.body);
    const deal = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 50), flashSalePrice: 1 });
    check('đặt Deal Price 1 → 200', deal.status === 200, deal.body);
    const row = await prisma.podFlashSaleItem.findUnique({ where: { id: ids[0] }, select: { flashSalePrice: true } });
    check('Deal Price ghi đúng 1.00', row?.flashSalePrice.equals(1) === true, row);
    const lim = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 1000), totalPurchaseLimit: 20, customerPurchaseLimit: 2 });
    check('Total limit + Limit per buyer cho 1.000 dòng → 200', lim.status === 200, lim.body);
    const limRow = await prisma.podFlashSaleItem.findUnique({ where: { id: ids[500] }, select: { totalPurchaseLimit: true, customerPurchaseLimit: true } });
    check('giới hạn ghi đúng 20 / 2', limRow?.totalPurchaseLimit === 20 && limRow?.customerPurchaseLimit === 2, limRow);
    const combo = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 20), discountPercent: 30, totalPurchaseLimit: 5, customerPurchaseLimit: 1 });
    check('kết hợp nhiều trường → 200', combo.status === 200, combo.body);

    console.log('\n▶ 5. Dữ liệu xấu');
    const dup = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: [ids[0], ids[0], ids[1]], discountPercent: 5 });
    check('id lặp ⇒ requested=2, updated=2', dup.data?.batchResult?.requested === 2 && dup.data?.batchResult?.updated === 2, dup.body);
    const ghost = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: [ids[0], randomUUID()], discountPercent: 5 });
    check('id không tồn tại ⇒ 1 skipped ITEM_NOT_FOUND, dòng kia vẫn cập nhật', ghost.data?.batchResult?.updated === 1 && ghost.data?.batchResult?.failures?.[0]?.code === 'ITEM_NOT_FOUND', ghost.body);
    const none = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: [randomUUID()], discountPercent: 5 });
    check('không id nào thuộc đợt ⇒ 404', none.status === 404, none.body);
    const tooMany = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 1001), discountPercent: 5 });
    check('1.001 id trong một request ⇒ 400 VALIDATION_ERROR (trần 1.000/request)', tooMany.status === 400, tooMany.body);

    console.log('\n▶ 6. Bấm Apply hai lần (retry) ⇒ cùng kết quả, không nhân đôi');
    const a = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 100), discountPercent: 30 });
    const b = await call(token, 'PATCH', `/pod/flash-sales/${id}/items/batch`, { itemIds: ids.slice(0, 100), discountPercent: 30 });
    const rowA = await prisma.podFlashSaleItem.findUnique({ where: { id: ids[5] }, select: { flashSalePrice: true, originalPrice: true } });
    check('hai lần cùng payload ⇒ 200/200 và giá vẫn = retail × 0,7', a.status === 200 && b.status === 200 && rowA!.flashSalePrice.equals(rowA!.originalPrice!.mul(70).div(100).toDecimalPlaces(2)), rowA);
  } finally {
    console.log('\n▶ dọn dẹp');
    const del = await call(token, 'DELETE', `/pod/flash-sales/${id}`);
    check('DELETE đợt sale thử nghiệm → 204', del.status === 204, del.body);
    const left = await prisma.podFlashSale.findUnique({ where: { id }, select: { deletedAt: true } });
    check('đợt sale thử nghiệm đã xoá (soft delete)', left === null || left.deletedAt !== null, left);
    await prisma.$disconnect();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} đạt · ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
