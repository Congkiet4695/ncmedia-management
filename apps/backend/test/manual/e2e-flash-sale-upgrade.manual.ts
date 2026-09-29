/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật) cho đợt nâng cấp module Flash Sale — kịch bản A → J.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-flash-sale-upgrade.manual.ts
 *
 * Đường đi THẬT: PodFlashSaleService / ItemService / PublisherService / ImportService ─▶ Prisma
 * ─▶ PostgreSQL (CHECK constraint, UNIQUE, `FOR UPDATE`, truy vấn thống kê gộp đều chạy thật).
 *
 * TikTok được thay bằng một bản giả lập TRONG BỘ NHỚ ở đúng ranh giới SDK
 * (`TikTokSdkService.execute` + `api.PromotionV202309Api.*`) — `TiktokPromotionApiService` là
 * code thật, kể cả vòng phân trang `searchAllActivities`. Không gọi TikTok thật.
 *
 * Bản giả lập làm đúng những gì tài liệu TikTok mô tả và những gì đã kiểm trong SDK:
 *  - Update Activity Products: THÊM/sửa mục theo id, KHÔNG gỡ mục cũ; response chỉ có
 *    `totalCount` (không có danh sách sản phẩm).
 *  - Get Activity: trả `products[].skus[]` đang có trong hoạt động.
 *  - Search Activities: phân trang theo `page_token` (cố ý trả trang NHỎ để thử > 20 bản ghi).
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối (kể cả khi thất bại).
 */
import { PrismaClient } from '@prisma/client';
import { FakeTiktok, MemoryLocks } from './support/fake-tiktok-promotion';
import { PodAccessScopeService } from '../../src/modules/pod-tiktok/services/pod-access-scope.service';
import { PodProductMapper } from '../../src/modules/pod-product/mappers/pod-product.mapper';
import { PodProductRepository } from '../../src/modules/pod-product/repositories/pod-product.repository';
import { TiktokPromotionApiService } from '../../src/modules/tiktok-sdk/tiktok-promotion-api.service';
import { PodFlashSaleImportService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-import.service';
import { PodFlashSaleItemService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-item.service';
import { PodFlashSalePublisherService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-publisher.service';
import { PodFlashSaleValidatorService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-validator.service';
import { PodFlashSaleService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale.service';

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const SCOPE = { allShops: true, accountIds: [], shopIds: [] };
const RUN = `E2EUPG${Date.now()}`;

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const shop = await prisma.podTiktokShop.findFirst({
    where: { deletedAt: null },
    select: { id: true, organizationId: true, accountId: true },
  });
  if (!shop) throw new Error('Cần ít nhất một shop TikTok trong database local');
  const user = await prisma.user.findFirst({ where: { organizationId: shop.organizationId }, select: { id: true } });
  if (!user) throw new Error('Cần ít nhất một user trong tổ chức của shop');
  const org = shop.organizationId;

  const fake = new FakeTiktok(RUN);
  const promotionApi = new TiktokPromotionApiService(fake.sdk() as never);
  const shopContext = { resolve: async () => ({ accessToken: 't', shopCipher: 'c', shopId: shop.id, organizationId: org }) };
  const locks = new MemoryLocks();
  const accessScope = new PodAccessScopeService(prisma as never);
  const flashSales = new PodFlashSaleService(prisma as never, accessScope, new PodFlashSaleValidatorService());
  const items = new PodFlashSaleItemService(prisma as never, flashSales);
  const publisher = new PodFlashSalePublisherService(prisma as never, flashSales, promotionApi, shopContext as never, locks as never);
  const importer = new PodFlashSaleImportService(prisma as never, flashSales, publisher, promotionApi, accessScope, locks as never);

  const productIds: string[] = [];
  const createdFlashSaleIds = new Set<string>();

  // 30 sản phẩm × 1 SKU (tổng 30 dòng — hơn trang 20 của giao diện) + 1 sản phẩm 6 SKU (A1..D2).
  const repo = new PodProductRepository(prisma as never);
  const mapper = new PodProductMapper();
  const sync = async (tiktokProductId: string, skus: Array<{ id: string; seller: string }>) => {
    const payload = {
      id: tiktokProductId,
      title: `${RUN} ${tiktokProductId}`,
      status: 'ACTIVATE',
      skus: skus.map((s) => ({ id: s.id, sellerSku: s.seller, price: { salePrice: '20.00', currency: 'USD' }, salesAttributes: [{ name: 'Size', valueName: s.seller }] })),
    };
    const row = await repo.upsertAggregate(org, shop.accountId, shop.id, mapper.toWriteData(payload as never, payload), null);
    productIds.push(row.id as string);
    return row.id as string;
  };
  const bulkProducts: string[] = [];
  for (let i = 0; i < 30; i++) bulkProducts.push(await sync(`${RUN}-P${i}`, [{ id: `${RUN}-S${i}`, seller: `S${i}` }]));
  const letters = ['A1', 'A2', 'B1', 'B2', 'C1', 'D1'];
  const multiProduct = await sync(`${RUN}-PM`, letters.map((l) => ({ id: `${RUN}-${l}`, seller: l })));
  const variantOf = async (seller: string) =>
    (await prisma.podProductVariant.findFirstOrThrow({ where: { productId: multiProduct, sellerSku: seller } })).id;

  const statsOf = async (id: string) => (await flashSales.loadStats(org, [id])).get(id)!;
  const startAt = () => new Date(Date.now() + 2 * 3_600_000).toISOString();
  const endAt = () => new Date(Date.now() + 6 * 3_600_000).toISOString();

  try {
    // ------------------------------------------------------------------ A. Tạo
    const fsA = await flashSales.create(org, user.id, { shopId: shop.id, name: `${RUN} A`, startAt: startAt(), endAt: endAt() }, SCOPE);
    createdFlashSaleIds.add(fsA.id);
    await items.addItems(org, user.id, fsA.id, bulkProducts.map((productId) => ({ productId, flashSalePrice: 15 })), SCOPE);
    let s = await statsOf(fsA.id);
    check('A. tạo 30 dòng: thống kê 30 tổng / 30 chờ gửi / 0 thành công / 0 thất bại',
      s.totalItems === 30 && s.pendingItems === 30 && s.publishedItems === 0 && s.failedItems === 0, JSON.stringify(s));

    // ------------------------------------------------------------------ B1. Duplicate TRƯỚC khi chạy
    const dupBefore = await flashSales.duplicate(org, user.id, fsA.id, { name: `${RUN} A copy1` }, SCOPE);
    createdFlashSaleIds.add(dupBefore.id);
    check('B. duplicate trước khi chạy: bản sao đủ 30 dòng', dupBefore.items.length === 30, `${dupBefore.items.length}/30`);

    // ------------------------------------------------------------------ C. Chạy, TikTok không nhận 5 SKU
    for (let i = 25; i < 30; i++) fake.silentlyRejected.add(`${RUN}-S${i}`);
    await publisher.publish(org, user.id, fsA.id, {}, SCOPE);
    await publisher.whenPublishIdle();
    let row = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsA.id } });
    s = await statsOf(fsA.id);
    check('C. lỗi một phần: 25 thành công / 5 thất bại (không đánh dấu cả lô PUBLISHED)',
      s.publishedItems === 25 && s.failedItems === 5, JSON.stringify(s));
    check('C. đợt vẫn RUNNING, activity trên TikTok có đúng 25 SKU',
      row.status === 'RUNNING' && [...fake.activities.get(row.providerFlashSaleId!)!.products.values()].length === 25, row.status);
    const failedRows = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: fsA.id, status: 'FAILED' } });
    check('C. dòng thất bại mang mã NOT_ACCEPTED_BY_TIKTOK', failedRows.every((r) => r.errorCode === 'NOT_ACCEPTED_BY_TIKTOK'));

    // ------------------------------------------------------------------ D. Gửi lại: sửa được 3/5
    for (let i = 25; i < 28; i++) fake.silentlyRejected.delete(`${RUN}-S${i}`);
    const callsBeforeRetry = fake.productCalls.length;
    const pushD = await publisher.pushPendingItems(org, user.id, fsA.id, SCOPE);
    await publisher.whenPublishIdle();
    s = await statsOf(fsA.id);
    const retryCalls = fake.productCalls.slice(callsBeforeRetry).flat();
    check('D. gửi lại chỉ 5 dòng hỏng (không gửi lại 25 dòng đã thành công)', pushD.totalItems === 5 && retryCalls.length === 5, `${retryCalls.length} SKU gửi lại`);
    check('D. kết quả cuối 28/2, tổng vẫn 30 (không đếm đôi)',
      s.publishedItems === 28 && s.failedItems === 2 && s.totalItems === 30, JSON.stringify(s));
    row = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsA.id } });
    check('D. đợt vẫn RUNNING sau khi gửi lại', row.status === 'RUNNING');

    // ------------------------------------------------------------------ Lượt hỏng cả lô ⇒ FAILED ⇒ Retry
    const fsR = await flashSales.create(org, user.id, { shopId: shop.id, name: `${RUN} R`, startAt: startAt(), endAt: endAt() }, SCOPE);
    createdFlashSaleIds.add(fsR.id);
    await items.addItems(org, user.id, fsR.id, bulkProducts.slice(0, 22).map((productId) => ({ productId, flashSalePrice: 15 })), SCOPE);
    fake.failNextProductCalls = 1;
    fake.silentlyRejected.clear();
    await publisher.publish(org, user.id, fsR.id, {}, SCOPE);
    await publisher.whenPublishIdle();
    row = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsR.id } });
    s = await statsOf(fsR.id);
    check('D. TikTok từ chối lô ⇒ đợt FAILED, 22 dòng FAILED mang lỗi TikTok, 0 SUCCESS',
      row.status === 'FAILED' && s.failedItems === 22 && s.publishedItems === 0, `${row.status} ${JSON.stringify(s)}`);
    await publisher.retry(org, user.id, fsR.id, {}, SCOPE);
    await publisher.whenPublishIdle();
    row = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsR.id } });
    s = await statsOf(fsR.id);
    check('D. Retry ⇒ RUNNING, 22/0, tổng 22 (không đếm đôi)',
      row.status === 'RUNNING' && s.publishedItems === 22 && s.failedItems === 0 && s.totalItems === 22, `${row.status} ${JSON.stringify(s)}`);

    // ------------------------------------------------------------------ B2. Duplicate SAU khi chạy (có FAILED + REMOVED)
    const firstPublished = await prisma.podFlashSaleItem.findFirstOrThrow({ where: { flashSaleId: fsA.id, status: 'PUBLISHED' } });
    await prisma.podFlashSaleItem.update({ where: { id: firstPublished.id }, data: { status: 'REMOVED' } });
    const dupAfter = await flashSales.duplicate(org, user.id, fsA.id, { name: `${RUN} A copy2` }, SCOPE);
    createdFlashSaleIds.add(dupAfter.id);
    check('B. duplicate sau khi chạy: đủ 30 dòng (kể cả 2 FAILED + 1 REMOVED), tất cả chưa gửi',
      dupAfter.items.length === 30 && dupAfter.items.every((i) => i.status === 'READY' || i.status === 'PENDING'),
      `${dupAfter.items.length}/30`);
    await prisma.podFlashSaleItem.update({ where: { id: firstPublished.id }, data: { status: 'PUBLISHED' } });

    // ------------------------------------------------------------------ G. Đợt đang chạy: A1 A2, thêm B1 B2
    const fsG = await flashSales.create(org, user.id, { shopId: shop.id, name: `${RUN} G`, startAt: startAt(), endAt: endAt() }, SCOPE);
    createdFlashSaleIds.add(fsG.id);
    await items.addItems(org, user.id, fsG.id, [
      { productId: multiProduct, variantId: await variantOf('A1'), flashSalePrice: 12 },
      { productId: multiProduct, variantId: await variantOf('A2'), flashSalePrice: 12 },
    ], SCOPE);
    await publisher.publish(org, user.id, fsG.id, {}, SCOPE);
    await publisher.whenPublishIdle();
    const gActivity = (await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsG.id } })).providerFlashSaleId!;
    const aRowsBefore = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: fsG.id }, orderBy: { sortOrder: 'asc' } });

    await items.addItems(org, user.id, fsG.id, [
      { productId: multiProduct, variantId: await variantOf('B1'), flashSalePrice: 11 },
      { productId: multiProduct, variantId: await variantOf('B2'), flashSalePrice: 11 },
    ], SCOPE);
    const callsBeforeG = fake.productCalls.length;
    await publisher.pushPendingItems(org, user.id, fsG.id, SCOPE);
    await publisher.whenPublishIdle();
    const gSent = fake.productCalls.slice(callsBeforeG).flat();
    const gSkus = [...fake.activities.get(gActivity)!.products.values()].flatMap((p) => [...p.skus.keys()]).sort();
    check('G. chỉ gửi B1 B2 (không gửi lại A1 A2)', gSent.sort().join() === [`${RUN}-B1`, `${RUN}-B2`].join(), gSent.join());
    check('G. TikTok có A1 A2 B1 B2 — cùng activity_id, A không bị gỡ',
      gSkus.join() === ['A1', 'A2', 'B1', 'B2'].map((l) => `${RUN}-${l}`).join(), gSkus.join());
    const aRowsAfter = await prisma.podFlashSaleItem.findMany({ where: { id: { in: aRowsBefore.map((r) => r.id) } }, orderBy: { sortOrder: 'asc' } });
    check('G. dòng A1 A2 giữ nguyên (id, giá, trạng thái)',
      aRowsAfter.every((r, i) => r.status === 'PUBLISHED' && r.flashSalePrice.equals(aRowsBefore[i].flashSalePrice) && r.updatedAt.getTime() === aRowsBefore[i].updatedAt.getTime()));
    row = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsG.id } });
    s = await statsOf(fsG.id);
    check('G. đợt vẫn RUNNING, 4/4 PUBLISHED, cùng activity_id', row.status === 'RUNNING' && s.publishedItems === 4 && row.providerFlashSaleId === gActivity, `${row.status} ${JSON.stringify(s)}`);

    // ------------------------------------------------------------------ H. Update nhiều lần: C1, rồi D1
    for (const letter of ['C1', 'D1']) {
      await items.addItems(org, user.id, fsG.id, [{ productId: multiProduct, variantId: await variantOf(letter), flashSalePrice: 10 }], SCOPE);
      const before = fake.productCalls.length;
      await publisher.pushPendingItems(org, user.id, fsG.id, SCOPE);
      await publisher.whenPublishIdle();
      const sent = fake.productCalls.slice(before).flat();
      check(`H. lần thêm ${letter}: chỉ gửi đúng ${letter}`, sent.join() === `${RUN}-${letter}`, sent.join());
    }
    const hSkus = [...fake.activities.get(gActivity)!.products.values()].flatMap((p) => [...p.skus.keys()]).sort();
    s = await statsOf(fsG.id);
    check('H. TikTok có đủ 6 SKU A1 A2 B1 B2 C1 D1; hệ thống 6/6 PUBLISHED',
      hSkus.length === 6 && s.publishedItems === 6 && s.totalItems === 6, `${hSkus.length} SKU, ${JSON.stringify(s)}`);
    const noopPush = await publisher.pushPendingItems(org, user.id, fsG.id, SCOPE);
    check('H. không còn gì để gửi ⇒ không gọi TikTok, không đổi trạng thái', noopPush.totalItems === 0 && noopPush.status === 'RUNNING');

    // Dòng đã lên sàn không sửa/xoá được khi đang chạy; dòng chưa gửi thì được.
    const publishedRow = (await prisma.podFlashSaleItem.findFirstOrThrow({ where: { flashSaleId: fsG.id, status: 'PUBLISHED' } })).id;
    let blocked = false;
    try { await items.updateItem(org, user.id, fsG.id, publishedRow, { flashSalePrice: 9 }, SCOPE); } catch { blocked = true; }
    check('H. đợt RUNNING: không sửa được dòng đã PUBLISHED', blocked);

    // ------------------------------------------------------------------ E/I. Đồng bộ từ TikTok: 25 hoạt động (> 20, nhiều trang)
    for (let i = 0; i < 25; i++) {
      const a = fake.addActivity({ title: `${RUN} TikTok ${i}` });
      // Hoạt động đầu có 2 SKU của hệ thống + 1 SKU không có trong hệ thống.
      if (i === 0) {
        a.products.set(`${RUN}-P0`, { id: `${RUN}-P0`, skus: new Map([[`${RUN}-S0`, { id: `${RUN}-S0`, activityPrice: { amount: '14.00', currency: 'USD' }, quantityLimit: 10, quantityPerUser: 2 }]]) });
        a.products.set(`${RUN}-P1`, { id: `${RUN}-P1`, skus: new Map([[`${RUN}-S1`, { id: `${RUN}-S1`, activityPrice: { amount: '13.00', currency: 'USD' }, quantityLimit: -1, quantityPerUser: -1 }]]) });
        a.products.set(`${RUN}-PX`, { id: `${RUN}-PX`, skus: new Map([[`${RUN}-SX`, { id: `${RUN}-SX`, activityPrice: { amount: '5.00', currency: 'USD' }, quantityLimit: -1, quantityPerUser: -1 }]]) });
      }
    }
    // Một hoạt động mức SHOP — không hỗ trợ, phải bị bỏ qua chứ không làm hỏng lượt.
    fake.addActivity({ title: `${RUN} shop-wide`, productLevel: 'SHOP' });
    const totalActivities = fake.activities.size;

    const searchBefore = fake.searchCalls;
    const sync1 = await importer.syncFromTiktok(org, user.id, { shopId: shop.id }, SCOPE);
    const shop1 = sync1.shops[0];
    const importedRows = await prisma.podFlashSale.findMany({ where: { shopId: shop.id, providerFlashSaleId: { startsWith: `${RUN}-ACT-` } } });
    importedRows.forEach((r) => createdFlashSaleIds.add(r.id));
    check('I. phân trang: quét đủ mọi trang (trang 7 bản ghi)',
      shop1.scanned === totalActivities && fake.searchCalls - searchBefore === Math.ceil(totalActivities / fake.pageSize),
      `${shop1.scanned}/${totalActivities}, ${fake.searchCalls - searchBefore} trang`);
    check('E. đồng bộ lần 1: tạo 25 đợt source=TIKTOK, bỏ qua hoạt động mức SHOP',
      shop1.created === 25 && importedRows.filter((r) => r.source === 'TIKTOK').length === 25 && shop1.skipped >= 1,
      JSON.stringify({ created: shop1.created, updated: shop1.updated, unchanged: shop1.unchanged, skipped: shop1.skipped, failed: shop1.failed }));
    const t0 = importedRows.find((r) => r.name === `${RUN} TikTok 0`)!;
    const t0Items = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: t0.id } });
    const s0 = t0Items.find((i) => i.providerVariantId === `${RUN}-S0`);
    check('E. hoạt động 0: 2 dòng khớp theo tiktok_sku_id, 1 SKU chưa có ⇒ unmatched (không bịa dòng)',
      t0Items.length === 2 && shop1.unmatchedItems === 1, `${t0Items.length} dòng, unmatched=${shop1.unmatchedItems}`);
    check('E. giá/giới hạn lấy từ TikTok, giá gốc từ biến thể trong hệ thống',
      !!s0 && s0.flashSalePrice.toString() === '14' && s0.originalPrice.toString() === '20' && s0.totalPurchaseLimit === 10 && s0.customerPurchaseLimit === 2 && s0.status === 'PUBLISHED',
      s0 ? `${s0.flashSalePrice}/${s0.originalPrice}/${s0.totalPurchaseLimit}/${s0.customerPurchaseLimit}` : 'thiếu');
    check('E. đợt của hệ thống (A, G, R) KHÔNG bị tạo trùng', shop1.updated + shop1.unchanged >= 3);

    // ------------------------------------------------------------------ F. Đồng bộ lần 2 — idempotent
    const countBefore = await prisma.podFlashSale.count({ where: { shopId: shop.id } });
    const itemsBefore = await prisma.podFlashSaleItem.count({ where: { flashSale: { shopId: shop.id } } });
    const sync2 = await importer.syncFromTiktok(org, user.id, { shopId: shop.id }, SCOPE);
    const countAfter = await prisma.podFlashSale.count({ where: { shopId: shop.id } });
    const itemsAfter = await prisma.podFlashSaleItem.count({ where: { flashSale: { shopId: shop.id } } });
    check('F. đồng bộ lần 2: 0 tạo mới, 0 cập nhật, không thêm bản ghi/dòng nào',
      sync2.created === 0 && sync2.updated === 0 && countAfter === countBefore && itemsAfter === itemsBefore,
      `created=${sync2.created} updated=${sync2.updated} fs ${countBefore}->${countAfter} items ${itemsBefore}->${itemsAfter}`);

    // Đợt G sau 2 lượt đồng bộ vẫn đủ 6/6 — đồng bộ không gỡ nhầm.
    s = await statsOf(fsG.id);
    check('F. đợt G sau đồng bộ vẫn 6/6 PUBLISHED', s.publishedItems === 6 && s.removedItems === 0, JSON.stringify(s));

    // SKU bị gỡ trên Seller Center ⇒ lần đồng bộ sau đánh dấu REMOVED (không xoá).
    fake.activities.get(gActivity)!.products.get(`${RUN}-PM`)!.skus.delete(`${RUN}-D1`);
    await importer.syncFromTiktok(org, user.id, { shopId: shop.id }, SCOPE);
    s = await statsOf(fsG.id);
    check('F. SKU bị gỡ trên TikTok ⇒ REMOVED (giữ dòng), còn 5 PUBLISHED', s.publishedItems === 5 && s.removedItems === 1 && s.totalItems === 6, JSON.stringify(s));

    // ------------------------------------------------------------------ J. Đồng thời
    // J1: hai lượt gửi thêm cùng lúc ⇒ đúng MỘT lượt chạy.
    await items.addItems(org, user.id, fsA.id, [{ productId: multiProduct, variantId: await variantOf('A1'), flashSalePrice: 12 }], SCOPE);
    const callsBeforeJ = fake.productCalls.length;
    const both = await Promise.allSettled([
      publisher.pushPendingItems(org, user.id, fsA.id, SCOPE),
      publisher.pushPendingItems(org, user.id, fsA.id, SCOPE),
    ]);
    await publisher.whenPublishIdle();
    // Lượt thứ hai hoặc bị từ chối (đợt đang PUBLISHING), hoặc — nếu lượt đầu đã xong trước khi
    // nó giành lượt — thấy không còn gì để gửi. Không bao giờ gửi lại cùng một dòng.
    const ran = both.filter((r) => r.status === 'fulfilled' && r.value.totalItems > 0).length;
    const jSent = fake.productCalls.slice(callsBeforeJ).flat();
    check('J. hai lượt gửi thêm cùng lúc ⇒ đúng 1 lượt gửi, mỗi SKU chỉ gửi MỘT lần',
      ran === 1 && new Set(jSent).size === jSent.length && jSent.includes(`${RUN}-A1`),
      `${ran} lượt gửi, ${jSent.length} SKU: ${jSent.join()}`);

    // J2: đồng bộ trong lúc đợt đang PUBLISHING ⇒ bỏ qua đợt đó, không đụng dòng nào.
    await items.addItems(org, user.id, fsA.id, [{ productId: multiProduct, variantId: await variantOf('A2'), flashSalePrice: 12 }], SCOPE);
    await prisma.podFlashSale.update({ where: { id: fsA.id }, data: { status: 'PUBLISHING' } });
    const snapshot = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: fsA.id }, select: { id: true, status: true, updatedAt: true } });
    await importer.syncFromTiktok(org, user.id, { shopId: shop.id }, SCOPE);
    const afterSync = await prisma.podFlashSaleItem.findMany({ where: { flashSaleId: fsA.id }, select: { id: true, status: true, updatedAt: true } });
    const untouched = snapshot.every((r) => {
      const now = afterSync.find((x) => x.id === r.id);
      return now && now.status === r.status && now.updatedAt.getTime() === r.updatedAt.getTime();
    });
    const aRow = await prisma.podFlashSale.findUniqueOrThrow({ where: { id: fsA.id } });
    check('J. đồng bộ khi đợt đang PUBLISHING ⇒ không đổi trạng thái đợt, không đụng dòng nào', untouched && aRow.status === 'PUBLISHING');

    // J3: đang PUBLISHING ⇒ không thêm/sửa được (Run + Update).
    let addBlocked = false;
    try { await items.addItems(org, user.id, fsA.id, [{ productId: multiProduct, variantId: await variantOf('B1'), flashSalePrice: 12 }], SCOPE); } catch { addBlocked = true; }
    check('J. đang PUBLISHING ⇒ chặn thêm sản phẩm', addBlocked);
    await prisma.podFlashSale.update({ where: { id: fsA.id }, data: { status: 'RUNNING' } });

    // J4: hai lượt đồng bộ cùng lúc trên cùng shop ⇒ một lượt BUSY (409), không tạo trùng.
    const syncs = await Promise.allSettled([
      importer.syncFromTiktok(org, user.id, { shopId: shop.id }, SCOPE),
      importer.syncFromTiktok(org, user.id, { shopId: shop.id }, SCOPE),
    ]);
    const busy = syncs.filter((r) => r.status === 'rejected' && (r.reason as any)?.response?.code === 'POD_FLASH_SALE_IMPORT_BUSY').length;
    const dupCheck = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM (
        SELECT provider_flash_sale_id FROM pod_flash_sales
        WHERE shop_id = ${shop.id}::uuid AND provider_flash_sale_id IS NOT NULL
        GROUP BY provider_flash_sale_id HAVING COUNT(*) > 1) d`;
    check('J. hai lượt đồng bộ cùng lúc ⇒ một lượt BUSY, không có activity_id trùng', busy === 1 && Number(dupCheck[0].n) === 0, `busy=${busy}`);

    // ------------------------------------------------------------------ Danh sách: thống kê > 20 đợt, 1 truy vấn gộp
    const list = await flashSales.list(org, { shopId: shop.id, limit: 50, page: 1, search: RUN } as never, SCOPE);
    const listA = list.items.find((i) => i.id === fsA.id)!;
    check('I. danh sách > 20 đợt có thống kê từng đợt', list.items.length > 20 && list.items.every((i) => i.stats.totalItems >= 0), `${list.items.length} đợt`);
    check('A. danh sách hiển thị đúng số thành công/thất bại của đợt A',
      listA.stats.publishedItems === 31 && listA.stats.failedItems === 0 && listA.stats.pendingItems === 1 && listA.stats.totalProducts === 31 && listA.source === 'SYSTEM' && listA.lastRunAt !== null,
      JSON.stringify(listA.stats));
  } finally {
    await publisher.whenPublishIdle();
    if (createdFlashSaleIds.size > 0) {
      await prisma.podFlashSale.deleteMany({ where: { id: { in: [...createdFlashSaleIds] } } });
    }
    await prisma.podFlashSale.deleteMany({ where: { shopId: shop.id, name: { startsWith: RUN } } });
    if (productIds.length > 0) await prisma.podProduct.deleteMany({ where: { id: { in: productIds } } });
    results.push('INFO  đã dọn dữ liệu test');
  }
}

main()
  .catch((error) => results.push(`FAIL  lỗi không mong đợi — ${(error as Error).stack ?? (error as Error).message}`))
  .finally(async () => {
    console.log(results.join('\n'));
    await prisma.$disconnect();
    process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
  });
