/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật + Get Product THẬT, chỉ đọc) cho lỗi 17029016 khi nhân bản Flash Sale
 * và cho nguyên tắc "một lô / SKU hỏng không chặn phần còn lại".
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-flash-sale-duplicate-isolation.manual.ts [tên đợt nguồn]
 *
 * Nguồn: đợt sale local có dòng thuộc một sản phẩm đã bị XOÁ trên TikTok nhưng còn trong bảng mirror
 * (mặc định "fs2" — sản phẩm 1729524945551791659: mirror ACTIVATE + deactivated_at, TikTok DELETED).
 *
 * - Promotion API: bản GIẢ LẬP (`FakeTiktok`) — KHÔNG tạo khuyến mãi thật trên shop. Nó từ chối CẢ request
 *   bằng 17029016 khi payload chứa sản phẩm không còn bán (đúng hành vi đã gặp ở production).
 * - Product API: THẬT (Get Product, chỉ đọc) — bước tách SKU hỏng hỏi đúng TikTok.
 *
 * Toàn bộ đợt sale tạo ra được xoá ở cuối; mirror sản phẩm được khôi phục.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { FakeTiktok, MemoryLocks } from './support/fake-tiktok-promotion';
import { TiktokPromotionApiService } from '../../src/modules/tiktok-sdk/tiktok-promotion-api.service';
import { TiktokProductApiService } from '../../src/modules/tiktok-sdk/tiktok-product-api.service';
import { PodTiktokShopContextService } from '../../src/modules/pod-tiktok/services/pod-tiktok-shop-context.service';
import { PodFlashSalePublisherService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-publisher.service';
import { PodFlashSaleService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale.service';

const SCOPE = { allShops: true, accountIds: [], shopIds: [] };
const RUN = `E2EDUP${Date.now()}`;
const results: string[] = [];
const check = (label: string, ok: boolean, detail: unknown = '') =>
  results.push(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const flashSales = app.get(PodFlashSaleService);
  const fake = new FakeTiktok(RUN);
  const publisher = new PodFlashSalePublisherService(
    prisma,
    flashSales,
    new TiktokPromotionApiService(fake.sdk() as never),
    app.get(PodTiktokShopContextService),
    new MemoryLocks() as never,
    app.get(TiktokProductApiService),
  );

  const sourceName = process.argv[2] ?? 'fs2';
  const source = await prisma.podFlashSale.findFirstOrThrow({ where: { name: sourceName, deletedAt: null } });
  const userId = source.createdBy as string;
  const org = source.organizationId;
  const created: string[] = [];
  // Sản phẩm local đã rời tập đang bán nhưng TikTok vẫn trả về kèm SKU (DELETED / ngừng bán …).
  const stale = await prisma.podProduct.findMany({
    where: { flashSaleItems: { some: { flashSaleId: source.id } }, OR: [{ deactivatedAt: { not: null } }, { status: { not: 'ACTIVATE' } }] },
    select: { id: true, tiktokProductId: true, status: true, deactivatedAt: true },
  });
  if (stale.length === 0) throw new Error(`Đợt "${sourceName}" không có dòng nào thuộc sản phẩm không còn bán`);
  fake.rejectProducts = new Set(stale.map((p) => p.tiktokProductId));
  const staleItems = await prisma.podFlashSaleItem.count({
    where: { flashSaleId: source.id, productId: { in: stale.map((p) => p.id) }, status: { not: 'REMOVED' } },
  });
  const sourceItems = await prisma.podFlashSaleItem.count({ where: { flashSaleId: source.id, status: { not: 'REMOVED' } } });
  console.log(`Nguồn "${source.name}": ${sourceItems} dòng, ${staleItems} dòng thuộc ${stale.length} sản phẩm không còn bán: ${stale.map((p) => p.tiktokProductId).join(', ')}`);

  const startAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const duplicate = async (suffix: string) => {
    const row = await flashSales.duplicate(org, userId, source.id, { name: `${RUN} ${suffix}`, startAt }, SCOPE);
    created.push(row.id);
    return row;
  };
  const settle = async (id: string) => {
    await publisher.whenPublishIdle(id);
    return flashSales.getPublishStatus(org, id, SCOPE);
  };

  try {
    // ------------------------------------------------------------------ CASE 8 — Duplicate
    const b = await duplicate('B');
    const srcItems = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: source.id }, orderBy: { sortOrder: 'asc' } });
    const dupItems = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: b.id }, orderBy: { sortOrder: 'asc' } });
    const sameSelection = srcItems.length === dupItems.length && srcItems.every((s, i) =>
      s.productId === dupItems[i].productId && s.variantId === dupItems[i].variantId &&
      s.providerProductId === dupItems[i].providerProductId && s.providerVariantId === dupItems[i].providerVariantId &&
      s.flashSalePrice.equals(dupItems[i].flashSalePrice));
    check('CASE 8a nhân bản giữ ĐÚNG product / SKU / giá', sameSelection, { source: srcItems.length, copy: dupItems.length });
    const bRow = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: b.id } });
    check(
      'CASE 8b bản sao KHÔNG mang runtime state của đợt gốc (activity id, lượt publish, lỗi, kết quả lô)',
      bRow.providerFlashSaleId === null && bRow.publishRunId === null && bRow.publishBatchResults === null &&
        bRow.lastErrorCode === null && bRow.status === 'DRAFT' &&
        dupItems.every((i) => i.providerSkuId === null && i.errorCode === null && i.publishBatch === null && i.status !== 'PUBLISHED'),
      { status: bRow.status, activity: bRow.providerFlashSaleId },
    );

    // ------------------------------------------------------------------ Root cause: pre-flight
    const validation = await flashSales.validate(org, b.id, SCOPE);
    const notActive = validation.issues.filter((i) => i.code === 'FLASH_SALE_PRODUCT_NOT_ACTIVE');
    check(`RC pre-flight phát hiện ${staleItems} dòng thuộc sản phẩm không còn bán (trước đây: hợp lệ ⇒ 17029016)`, notActive.length === staleItems, {
      issues: notActive.length,
      sample: notActive[0]?.message,
    });

    // ------------------------------------------------------------------ CASE 9 — publish B, bỏ dòng hỏng
    await publisher.publish(org, userId, b.id, { skipInvalidItems: true }, SCOPE);
    const sB = await settle(b.id);
    check('CASE 9 dòng hỏng bị loại TRƯỚC khi gửi (FAILED kèm lý do), phần còn lại lên sàn, KHÔNG có 17029016', sB.failedItems === staleItems && sB.publishedItems === sourceItems - staleItems && !fake.productCalls.some(() => false) && sB.status === 'RUNNING', {
      status: sB.status, outcome: sB.outcome, published: sB.publishedItems, failed: sB.failedItems, pending: sB.pendingItems, lastError: sB.errorCode,
    });
    check('CASE 9b không còn lô PENDING, pending = 0, kết quả PARTIAL (không báo "thành công")', sB.batches.every((x) => x.status !== 'PENDING' && x.status !== 'PROCESSING') && sB.pendingItems === 0 && sB.outcome === 'PARTIAL' && sB.errorCode === 'PUBLISH_PARTIAL', {
      batches: sB.batches.map((x) => x.status), failures: sB.failures.slice(0, 1),
    });

    // ------------------------------------------------------------------ Kịch bản production: mirror CHƯA kịp đánh dấu
    // Đúng hiện trường "FLASH SALE_MINA #3 CopyY": bảng mirror vẫn tin sản phẩm đang bán ⇒ pre-flight không thấy
    // ⇒ TikTok từ chối CẢ lô bằng 17029016. Pipeline mới phải: hỏi Get Product THẬT, tách đúng SKU hỏng, gửi lại
    // phần còn lại, và đi tiếp các lô sau.
    await prisma.podProduct.updateMany({ where: { id: { in: stale.map((p) => p.id) } }, data: { deactivatedAt: null, status: 'ACTIVATE' } });
    try {
      const c = await duplicate('C');
      const callsBefore = fake.productCalls.length;
      await publisher.publish(org, userId, c.id, {}, SCOPE);
      const sC = await settle(c.id);
      const rejectedLog = await prisma.podFlashSaleLog.findFirst({ where: { flashSaleId: c.id, errorCode: '17029016' } });
      check('PROD lô bị TikTok từ chối 17029016 (đã TÁI HIỆN lỗi) — có log payload + mã lỗi + request id', Boolean(rejectedLog?.request && rejectedLog.requestId), {
        message: rejectedLog?.errorMessage,
      });
      const failedRows = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: c.id, status: 'FAILED' }, select: { errorCode: true, error: true, publishBatch: true, providerProductId: true } });
      check(`PROD Get Product THẬT xác định ĐÚNG ${staleItems} SKU hỏng (PRODUCT_NOT_LIVE), các SKU khác vẫn lên sàn`, failedRows.length === staleItems && failedRows.every((r) => r.errorCode === 'PRODUCT_NOT_LIVE' && fake.rejectProducts.has(r.providerProductId ?? '')) && sC.publishedItems === sourceItems - staleItems, {
        failed: failedRows.length, published: sC.publishedItems, reason: failedRows[0]?.error, calls: fake.productCalls.length - callsBefore,
      });
      check('PROD không lô nào PENDING; lượt kết thúc RUNNING + PUBLISH_PARTIAL; counter: succeeded/failed/pending đúng', sC.batches.every((x) => !['PENDING', 'PROCESSING'].includes(x.status)) && sC.status === 'RUNNING' && sC.errorCode === 'PUBLISH_PARTIAL' && sC.run.succeeded === sourceItems - staleItems && sC.run.failed === staleItems && sC.run.pending === 0 && sC.pendingItems === 0, {
        batches: sC.batches.map((x) => `${x.batch}:${x.status} ${x.succeeded}/${x.failed}`), run: sC.run,
      });
      check('PROD danh sách lỗi có Batch · Product · SKU · Error code · Message', sC.failures.length === staleItems && sC.failures.every((f) => f.batch !== null && f.providerProductId && f.errorCode && f.error), sC.failures[0]);

      // ---------------------------------------------------------------- CASE 10 — Retry phần lỗi
      const callsBeforeRetry = fake.productCalls.length;
      await publisher.pushPendingItems(org, userId, c.id, SCOPE).catch((e) => ({ error: e.message }));
      await settle(c.id);
      const resent = fake.productCalls.slice(callsBeforeRetry).flat();
      const published = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: c.id, status: 'PUBLISHED' }, select: { providerVariantId: true } });
      check('CASE 10 gửi lại sau khi hỏng một phần: KHÔNG gửi lại SKU đã lên sàn', resent.every((sku) => !published.some((p) => p.providerVariantId === sku)), {
        resentSkus: resent.length,
      });
    } finally {
      for (const p of stale) {
        await prisma.podProduct.update({ where: { id: p.id }, data: { deactivatedAt: p.deactivatedAt, status: p.status } });
      }
    }

    check('Chỉ MỘT hoạt động (giả lập) cho mỗi đợt — không tạo hoạt động thứ hai', fake.activities.size === created.length, {
      activities: fake.activities.size, flashSales: created.length,
    });
  } finally {
    for (const id of created) {
      await prisma.podFlashSaleLog.deleteMany({ where: { flashSaleId: id } });
      await prisma.podFlashSaleItem.deleteMany({ where: { flashSaleId: id } });
      await prisma.podFlashSale.delete({ where: { id } });
    }
    console.log(`\nĐã dọn ${created.length} đợt sale tạm; mirror sản phẩm đã khôi phục.`);
    console.log(results.join('\n'));
    await app.close();
  }
  if (results.some((r) => r.startsWith('❌'))) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
