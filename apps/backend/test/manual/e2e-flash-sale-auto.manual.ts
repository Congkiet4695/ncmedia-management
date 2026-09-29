/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật) cho Auto Flash Sale — chuỗi A → B → C.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-flash-sale-auto.manual.ts
 *
 * Đường đi THẬT: PodFlashSaleAutoService → PodFlashSaleService / PublisherService → Prisma →
 * PostgreSQL (partial unique index, `FOR UPDATE`, CHECK đều chạy thật). TikTok là bản giả lập ở
 * ranh giới SDK (`support/fake-tiktok-promotion.ts`) — `TiktokPromotionApiService` là code thật.
 *
 * Giờ giấc: validator của Publish dùng đồng hồ THẬT ("giờ bắt đầu phải ở tương lai"), nên kịch
 * bản đặt `endAt` tương đối với bây giờ (vd: còn 18 giờ ≈ cron 05:00, kết thúc 23:59) thay vì
 * ngày cố định 2026-01-15. Công thức lịch được kiểm riêng với ngày cố định trong
 * `pod-flash-sale-auto-schedule.spec.ts`.
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối (kể cả khi thất bại).
 */
import { PrismaClient } from '@prisma/client';
import { FakeTiktok, MemoryLocks } from './support/fake-tiktok-promotion';
import { PodAccessScopeService } from '../../src/modules/pod-tiktok/services/pod-access-scope.service';
import { PodProductMapper } from '../../src/modules/pod-product/mappers/pod-product.mapper';
import { PodProductRepository } from '../../src/modules/pod-product/repositories/pod-product.repository';
import { TiktokPromotionApiService } from '../../src/modules/tiktok-sdk/tiktok-promotion-api.service';
import { PodFlashSaleAutoService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-auto.service';
import { toZonedParts } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-auto-schedule';
import { PodFlashSaleItemService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-item.service';
import { PodFlashSalePublisherService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-publisher.service';
import { PodFlashSaleValidatorService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-validator.service';
import { PodFlashSaleService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale.service';

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
const SCOPE = { allShops: true, accountIds: [], shopIds: [] };
const RUN = `E2EAUTO${Date.now()}`;
const H = 3_600_000;
const TZ = 'America/Los_Angeles';

async function main(): Promise<void> {
  const shop1 = await prisma.podTiktokShop.findFirst({
    where: { deletedAt: null },
    select: { id: true, organizationId: true, accountId: true },
  });
  if (!shop1) throw new Error('Cần ít nhất một shop TikTok trong database local');
  const org = shop1.organizationId;
  const user = await prisma.user.findFirst({ where: { organizationId: org }, select: { id: true } });
  if (!user) throw new Error('Cần ít nhất một user trong tổ chức của shop');
  // Shop thứ hai của CÙNG tổ chức — kiểm cô lập theo shop.
  const shop2 = await prisma.podTiktokShop.create({
    data: {
      organizationId: org,
      accountId: shop1.accountId,
      tiktokShopId: `${RUN}-SHOP2`,
      shopCipherEnc: 'e2e-not-used',
      name: `${RUN} shop 2`,
      region: 'US',
      sellerType: 'LOCAL',
    },
    select: { id: true, organizationId: true, accountId: true },
  });
  const priorConfig = await prisma.podFlashSaleAutoConfig.findUnique({ where: { organizationId: org } });

  const fake = new FakeTiktok(RUN);
  const promotionApi = new TiktokPromotionApiService(fake.sdk() as never);
  const shopContext = {
    resolve: async (organizationId: string, shopId: string) => ({ accessToken: 't', shopCipher: `cipher-${shopId}`, shopId, organizationId }),
  };
  const accessScope = new PodAccessScopeService(prisma as never);
  const flashSales = new PodFlashSaleService(prisma as never, accessScope, new PodFlashSaleValidatorService());
  const items = new PodFlashSaleItemService(prisma as never, flashSales);
  /** Một "server": publisher + auto service + khoá riêng. */
  const server = () => {
    const locks = new MemoryLocks();
    const publisher = new PodFlashSalePublisherService(prisma as never, flashSales, promotionApi, shopContext as never, locks as never);
    return { publisher, auto: new PodFlashSaleAutoService(prisma as never, flashSales, publisher, locks as never) };
  };
  const { publisher, auto } = server();

  const productIds: string[] = [];
  const repo = new PodProductRepository(prisma as never);
  const mapper = new PodProductMapper();
  const syncProduct = async (shop: { id: string; accountId: string }, tiktokProductId: string, skus: string[], price = '20.00') => {
    const payload = {
      id: tiktokProductId,
      title: `${RUN} ${tiktokProductId}`,
      status: 'ACTIVATE',
      skus: skus.map((sku) => ({ id: `${tiktokProductId}-${sku}`, sellerSku: `${tiktokProductId}-${sku}`, price: { salePrice: price, currency: 'USD' }, salesAttributes: [{ name: 'Size', valueName: sku }] })),
    };
    const row = await repo.upsertAggregate(org, shop.accountId, shop.id, mapper.toWriteData(payload as never, payload), null);
    productIds.push(row.id as string);
    return row.id as string;
  };

  /** Tạo + publish một đợt, rồi đặt lại endAt cho kịch bản. */
  const makeRunning = async (
    shopId: string,
    label: string,
    addPayload: Array<{ productId: string; variantId?: string; discountPercent: number }>,
    opts: { productLevel?: 'PRODUCT' | 'VARIATION'; endInMs: number; timezone?: string },
  ) => {
    const fs = await flashSales.create(org, user.id, {
      shopId,
      name: `${RUN} ${label}`,
      startAt: new Date(Date.now() + H).toISOString(),
      endAt: new Date(Date.now() + 5 * H).toISOString(),
      timezone: opts.timezone ?? TZ,
    }, SCOPE);
    if (opts.productLevel === 'PRODUCT') await prisma.podFlashSale.update({ where: { id: fs.id }, data: { productLevel: 'PRODUCT' } });
    await items.addItems(org, user.id, fs.id, addPayload, SCOPE);
    await publisher.publish(org, user.id, fs.id, { skipInvalidItems: true }, SCOPE);
    await publisher.whenPublishIdle();
    await prisma.podFlashSale.update({ where: { id: fs.id }, data: { endAt: new Date(Date.now() + opts.endInMs) } });
    await auto.setAutoMode(org, user.id, fs.id, true, SCOPE);
    return fs.id;
  };
  const node = (id: string) => prisma.podFlashSale.findUniqueOrThrow({ where: { id } });
  const childOf = (id: string) => prisma.podFlashSale.findFirst({ where: { autoParentId: id, deletedAt: null } });
  const itemsOf = (id: string) => prisma.podFlashSaleItem.findMany({ where: { flashSaleId: id }, orderBy: { sortOrder: 'asc' } });
  const statsOf = async (id: string) => (await flashSales.loadStats(org, [id])).get(id)!;
  const wall = (d: Date) => {
    const p = toZonedParts(d, TZ);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  };

  try {
    // ---------------------------------------------------------------- dữ liệu
    // Shop 1: 25 sản phẩm × 1 SKU + 1 sản phẩm 6 SKU = 26 sản phẩm / 31 biến thể (> trang 20).
    const singles: string[] = [];
    for (let i = 0; i < 25; i++) singles.push(await syncProduct(shop1, `${RUN}-P${i}`, ['S']));
    const multi = await syncProduct(shop1, `${RUN}-PM`, ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    const multiVariants = await prisma.podProductVariant.findMany({ where: { productId: multi }, orderBy: { sellerSku: 'asc' } });
    const xPayload = [
      ...singles.map((productId, i) => ({ productId, discountPercent: 10 + (i % 5) * 5 })),
      ...multiVariants.map((v, i) => ({ productId: multi, variantId: v.id, discountPercent: 20 + i })),
    ];
    // Shop 2: 22 sản phẩm, mức PRODUCT.
    const shop2Products: string[] = [];
    for (let i = 0; i < 22; i++) shop2Products.push(await syncProduct(shop2, `${RUN}-Q${i}`, ['S'], '40.00'));

    // A của chuỗi X có 3 SKU bị TikTok từ chối ⇒ kết quả chạy của A: 28/3.
    for (let i = 0; i < 3; i++) fake.silentlyRejected.add(`${RUN}-P${i}-S`);
    const xA = await makeRunning(shop1.id, 'X', xPayload, { endInMs: 30 * H });
    fake.silentlyRejected.clear();
    const xAStats = await statsOf(xA);
    const yA = await makeRunning(shop2.id, 'Y', shop2Products.map((productId) => ({ productId, discountPercent: 25 })), { productLevel: 'PRODUCT', endInMs: 30 * H });
    const zA = await makeRunning(shop1.id, 'Z', singles.slice(0, 3).map((productId) => ({ productId, discountPercent: 15 })), { endInMs: 30 * H });
    const offA = await makeRunning(shop1.id, 'OFF', singles.slice(0, 2).map((productId) => ({ productId, discountPercent: 15 })), { endInMs: 5 * H });
    await auto.setAutoMode(org, user.id, offA, false, SCOPE);

    // ---------------------------------------------------------------- 1. còn > 24h ⇒ không tạo
    let run = await auto.runOrganization(org, 'MANUAL', new Date());
    const xNode = run!.nodes.find((n) => n.flashSaleId === xA);
    check('1. còn 30h (> 24h) ⇒ KHÔNG tạo (X không nằm trong tập tới hạn)', !xNode && !(await childOf(xA)));
    check('6. Auto OFF ⇒ không tạo', !run!.nodes.some((n) => n.flashSaleId === offA) && !(await childOf(offA)));

    // ---------------------------------------------------------------- 2/3/7. đúng 24h · < 24h · TikTok lỗi
    const now2 = new Date();
    await prisma.podFlashSale.update({ where: { id: xA }, data: { endAt: new Date(now2.getTime() + 24 * H) } });
    await prisma.podFlashSale.update({ where: { id: yA }, data: { endAt: new Date(now2.getTime() + 18 * H) } });
    await prisma.podFlashSale.update({ where: { id: zA }, data: { endAt: new Date(now2.getTime() + 20 * H) } });
    fake.failNextCreateActivity = 0;
    // Z: Create Activity của đợt kế tiếp bị TikTok từ chối. Thứ tự xử lý theo endAt: Y(18h) → Z(20h) → X(24h).
    const origPost = (promotionApi as any).sdk.api.PromotionV202309Api.ActivitiesPost;
    (promotionApi as any).sdk.api.PromotionV202309Api.ActivitiesPost = async (...args: any[]) => {
      if (String(args[3]?.title ?? '').includes(`${RUN} Z`)) {
        (promotionApi as any).sdk.api.PromotionV202309Api.ActivitiesPost = origPost;
        fake.failNextCreateActivity = 1;
      }
      return origPost(...args);
    };
    run = await auto.runOrganization(org, 'CRON', now2);
    const xB = await childOf(xA);
    const yB = await childOf(yA);
    const zB = await childOf(zA);
    check('2. còn ĐÚNG 24h ⇒ tạo B', !!xB && run!.nodes.find((n) => n.flashSaleId === xA)?.action === 'CREATED', JSON.stringify(run!.nodes.find((n) => n.flashSaleId === xA)));
    check('3. còn 18h (< 24h) ⇒ tạo B (chuỗi Y)', !!yB && run!.nodes.find((n) => n.flashSaleId === yA)?.action === 'CREATED');

    if (xB) {
      const a = await node(xA);
      check('9. B.start = A.end + 10 phút', xB.startAt.getTime() === a.endAt.getTime() + 10 * 60_000, `${wall(a.endAt)} → ${wall(xB.startAt)}`);
      const expectEnd = toZonedParts(xB.startAt, TZ);
      const endWall = toZonedParts(xB.endAt, TZ);
      const startWallPlus3 = new Date(Date.UTC(expectEnd.year, expectEnd.month - 1, expectEnd.day + 3, expectEnd.hour, expectEnd.minute - 1));
      check('10/17. B.end = B.start + 3 ngày lịch − 1 phút (theo múi giờ America/Los_Angeles)',
        endWall.year === startWallPlus3.getUTCFullYear() && endWall.month === startWallPlus3.getUTCMonth() + 1 && endWall.day === startWallPlus3.getUTCDate() && endWall.hour === startWallPlus3.getUTCHours() && endWall.minute === startWallPlus3.getUTCMinutes(),
        `${wall(xB.startAt)} → ${wall(xB.endAt)}`);
      const aItems = await itemsOf(xA);
      const bItems = await itemsOf(xB.id);
      check('12. chép ĐỦ sản phẩm: 26/26', new Set(bItems.map((i) => i.productId)).size === 26 && new Set(aItems.map((i) => i.productId)).size === 26);
      check('13. chép ĐỦ biến thể: 31/31 (kể cả 3 SKU A bị từ chối)', bItems.length === 31 && aItems.length === 31, `${bItems.length}/31`);
      const pctSame = aItems.every((ai) => bItems.some((bi) => bi.variantId === ai.variantId && bi.discountPercent.equals(ai.discountPercent)));
      check('16/28. giữ % giảm TỪNG SKU (không gộp thành một mức)', pctSame && new Set(bItems.map((i) => i.discountPercent.toString())).size > 1);
      check('15/27. giữ mức VARIATION', xB.productLevel === 'VARIATION');
      check('B có activity TikTok riêng, KHÁC A', !!xB.providerFlashSaleId && xB.providerFlashSaleId !== a.providerFlashSaleId);
      check('20. B lên TikTok đủ 31 SKU (chia lô, cùng một activity)', [...fake.activities.get(xB.providerFlashSaleId!)!.products.values()].reduce((n, p) => n + p.skus.size, 0) === 31);
      const bStats = await statsOf(xB.id);
      check('13. KHÔNG chép kết quả chạy: A 28/3, B 31/0 (kết quả của CHÍNH B)',
        xAStats.publishedItems === 28 && xAStats.failedItems === 3 && bStats.publishedItems === 31 && bStats.failedItems === 0,
        `A ${xAStats.publishedItems}/${xAStats.failedItems} · B ${bStats.publishedItems}/${bStats.failedItems}`);
      check('11/21. A Auto OFF, B Auto ON, cùng chain, #2', !a.autoMode && xB.autoMode && xB.autoChainId === a.autoChainId && xB.autoSequence === 2 && xB.status === 'RUNNING');
      check('30. tên "<gốc> - Auto #2"', xB.name === `${RUN} X - Auto #2`, xB.name);
    }
    if (yB) {
      const y = await node(yA);
      const yItems = await itemsOf(yB.id);
      check('14/27. chuỗi Y giữ mức PRODUCT, đủ 22 sản phẩm', yB.productLevel === 'PRODUCT' && yItems.length === 22 && yItems.every((i) => i.variantId === null));
      check('11/26. chuỗi Y ở shop 2, TikTok gọi bằng shop_cipher của shop 2', yB.shopId === shop2.id && fake.activities.get(yB.providerFlashSaleId!)!.shopCipher === `cipher-${shop2.id}` && !y.autoMode && yB.autoMode);
    }
    const zAfter = await node(zA);
    check('7/37. TikTok từ chối tạo B ⇒ A VẪN Auto ON, B = FAILED (không mất chuỗi)',
      zAfter.autoMode && zB?.status === 'FAILED' && !zB.autoMode && run!.nodes.find((n) => n.flashSaleId === zA)?.action === 'FAILED',
      `A.auto=${zAfter.autoMode} B=${zB?.status}`);
    check('25. chuỗi lỗi (Z) không chặn chuỗi khác (X, Y vẫn tạo)', !!xB && !!yB);
    check('32. lượt chạy ghi kết quả', run!.status === 'PARTIAL' && run!.created === 2 && run!.failed === 1, JSON.stringify({ s: run!.status, c: run!.created, f: run!.failed }));

    // ---------------------------------------------------------------- 8/9/38. chạy lại ⇒ retry B, không tạo C, không trùng
    const zChainBefore = await prisma.podFlashSale.count({ where: { autoChainId: zAfter.autoChainId! } });
    run = await auto.runOrganization(org, 'CRON', new Date());
    const zB2 = await childOf(zA);
    const zChainAfter = await prisma.podFlashSale.count({ where: { autoChainId: zAfter.autoChainId! } });
    check('38. lượt sau RETRY đúng B (không tạo C) ⇒ B RUNNING, Auto chuyển A → B',
      zB2?.id === zB?.id && zB2?.status === 'RUNNING' && zB2?.autoMode === true && !(await node(zA)).autoMode && zChainAfter === zChainBefore,
      `B=${zB2?.status} chain ${zChainBefore}→${zChainAfter}`);
    check('9. cron chạy lại: X/Y không tạo thêm (B chưa tới hạn)', (await prisma.podFlashSale.count({ where: { autoParentId: { in: [xA, yA] } } })) === 2);

    // ---------------------------------------------------------------- 5. bật Auto ở đợt đã có đợt kế tiếp ⇒ chặn
    let hasNext = '';
    try { await auto.setAutoMode(org, user.id, xA, true, SCOPE); } catch (e: any) { hasNext = e?.response?.code; }
    check('5/22. bật lại Auto ở A (đã có B) ⇒ 409 POD_FLASH_SALE_AUTO_HAS_NEXT', hasNext === 'POD_FLASH_SALE_AUTO_HAS_NEXT', hasNext);

    // ---------------------------------------------------------------- 40. chu kỳ kế: B → C, giá gốc đổi
    if (xB) {
      await prisma.podProductVariant.updateMany({ where: { productId: singles[5] }, data: { salePrice: 30 } });
      // Thời gian trôi: lượt cron chạy khi B còn 10 giờ (đồng hồ của job được truyền vào).
      run = await auto.runOrganization(org, 'CRON', new Date(xB.endAt.getTime() - 10 * H));
      const xC = await childOf(xB.id);
      const bNow = await node(xB.id);
      check('40. chu kỳ kế: tạo C từ B, B OFF, C ON, #3', !!xC && !bNow.autoMode && xC!.autoMode && xC!.autoSequence === 3 && xC!.startAt.getTime() === bNow.endAt.getTime() + 10 * 60_000);
      if (xC) {
        const cItem = (await itemsOf(xC.id)).find((i) => i.productId === singles[5])!;
        const bItem = (await itemsOf(xB.id)).find((i) => i.productId === singles[5])!;
        check('29. giữ % giảm, tính lại trên giá HIỆN TẠI (30 × (1−%))',
          cItem.discountPercent.equals(bItem.discountPercent) && cItem.originalPrice.toString() === '30' &&
            cItem.flashSalePrice.toString() === (30 * (1 - Number(bItem.discountPercent) / 100)).toFixed(2).replace(/\.?0+$/, ''),
          `% ${bItem.discountPercent}→${cItem.discountPercent}, giá ${bItem.flashSalePrice}→${cItem.flashSalePrice}`);
        check('30. tên C = "<gốc> - Auto #3" (không lặp hậu tố)', xC.name === `${RUN} X - Auto #3`, xC.name);
        let chainActive = '';
        try { await auto.setAutoMode(org, user.id, xB.id, true, SCOPE); } catch (e: any) { chainActive = e?.response?.code; }
        check('5. mỗi chuỗi chỉ một đợt ON (bật B khi C đang ON ⇒ 409)', chainActive === 'POD_FLASH_SALE_AUTO_HAS_NEXT' || chainActive === 'POD_FLASH_SALE_AUTO_CHAIN_ACTIVE', chainActive);
        const chain = await auto.getChain(org, xB.id, SCOPE);
        check('31. lịch sử chuỗi A → B → C (trước/sau)', chain.nodes.length === 3 && chain.previousId === xA && chain.nextId === xC.id, chain.nodes.map((n) => n.autoSequence).join('→'));
        // 23. tắt Auto ở C ⇒ không tạo D dù đã tới hạn.
        await auto.setAutoMode(org, user.id, xC.id, false, SCOPE);
        await auto.runOrganization(org, 'CRON', new Date(xC.endAt.getTime() - 2 * H));
        check('23. tắt Auto ở C ⇒ không tạo D', !(await childOf(xC.id)));
      }
    }

    // ---------------------------------------------------------------- 4. đã hết hạn
    const eSoon = await makeRunning(shop1.id, 'E1', singles.slice(0, 2).map((productId) => ({ productId, discountPercent: 15 })), { endInMs: 5 * H });
    await prisma.podFlashSale.update({ where: { id: eSoon }, data: { startAt: new Date(Date.now() - 3 * H), endAt: new Date(Date.now() - 5 * 60_000), status: 'ENDED' } });
    const eLate = await makeRunning(shop1.id, 'E2', singles.slice(0, 2).map((productId) => ({ productId, discountPercent: 15 })), { endInMs: 5 * H });
    await prisma.podFlashSale.update({ where: { id: eLate }, data: { startAt: new Date(Date.now() - 5 * H), endAt: new Date(Date.now() - 2 * H), status: 'ENDED' } });
    run = await auto.runOrganization(org, 'CRON', new Date());
    check('4/24. vừa hết hạn 5 phút (B.start vẫn ở tương lai) ⇒ tạo B', !!(await childOf(eSoon)) && !(await node(eSoon)).autoMode);
    check('4. hết hạn 2 giờ (B.start đã qua) ⇒ KHÔNG tạo, FAILED, A vẫn ON',
      !(await childOf(eLate)) && (await node(eLate)).autoMode && run!.nodes.find((n) => n.flashSaleId === eLate)?.action === 'FAILED');
    await auto.setAutoMode(org, user.id, eLate, false, SCOPE);

    // ---------------------------------------------------------------- 10/15. hai server cùng chạy
    const vA = await makeRunning(shop1.id, 'V', singles.slice(0, 4).map((productId) => ({ productId, discountPercent: 15 })), { endInMs: 6 * H });
    const s1 = server();
    const s2 = server();
    const both = await Promise.all([s1.auto.runOrganization(org, 'CRON', new Date()), s2.auto.runOrganization(org, 'CRON', new Date())]);
    await Promise.all([s1.publisher.whenPublishIdle(), s2.publisher.whenPublishIdle()]);
    const vChildren = await prisma.podFlashSale.count({ where: { autoParentId: vA } });
    check('10/15. hai server (khoá Redis riêng) chạy cùng lúc ⇒ đúng MỘT B', vChildren === 1,
      `${vChildren} B · actions=${both.map((r) => r?.nodes.find((n) => n.flashSaleId === vA)?.action ?? '—').join(',')}`);
    const busyTwice = await Promise.all([auto.runOrganization(org, 'CRON', new Date()), auto.runOrganization(org, 'CRON', new Date())]);
    check('17. cùng server, hai lượt cùng lúc ⇒ lượt sau bị khoá (null)', busyTwice.filter((r) => r === null).length === 1);

    // ---------------------------------------------------------------- lịch chạy (cron config)
    const now = new Date();
    const p = toZonedParts(new Date(now.getTime() - 60_000), TZ);
    const runTime = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    const cfg = await auto.updateConfig(org, user.id, { enabled: true, runTime, timezone: TZ }, now);
    const lastRunBefore = (await prisma.podFlashSaleAutoConfig.findUniqueOrThrow({ where: { organizationId: org } })).lastRunAt;
    await auto.runDueOrganizations(now);
    const afterSave = await prisma.podFlashSaleAutoConfig.findUniqueOrThrow({ where: { organizationId: org } });
    check('34. lưu cấu hình ⇒ mốc đã qua hôm nay KHÔNG chạy ngay; nextRun = ngày mai',
      afterSave.lastRunAt?.getTime() === lastRunBefore?.getTime() && new Date(cfg.nextRunAt!).getTime() > now.getTime(), cfg.nextRunAt ?? '');
    await prisma.podFlashSaleAutoConfig.update({ where: { organizationId: org }, data: { lastScheduledAt: new Date(now.getTime() - 25 * H) } });
    await auto.runDueOrganizations(now);
    const afterMissed = await prisma.podFlashSaleAutoConfig.findUniqueOrThrow({ where: { organizationId: org } });
    check('24. server tắt đúng giờ chạy ⇒ nhịp quét sau CHẠY BÙ (trigger CRON)', afterMissed.lastRunTrigger === 'CRON' && (afterMissed.lastRunAt?.getTime() ?? 0) >= now.getTime() - 1000);
    await auto.runDueOrganizations(now);
    const afterAgain = await prisma.podFlashSaleAutoConfig.findUniqueOrThrow({ where: { organizationId: org } });
    check('9. cùng mốc quét lần 2 ⇒ KHÔNG chạy lại (mỗi ngày một lần)', afterAgain.lastRunAt?.getTime() === afterMissed.lastRunAt?.getTime());
    const perm = await prisma.rolePermission.count({ where: { role: { organizationId: org, code: 'ADMIN' }, permission: { code: 'pod.flashsale.auto.config' } } });
    const permEmp = await prisma.rolePermission.count({ where: { role: { organizationId: org, code: 'EMPLOYEE' }, permission: { code: 'pod.flashsale.auto.config' } } });
    check('44. quyền pod.flashsale.auto.config: Admin CÓ, Employee KHÔNG', perm === 1 && permEmp === 0);
  } finally {
    await publisher.whenPublishIdle();
    const ids = (await prisma.podFlashSale.findMany({ where: { organizationId: org, name: { startsWith: RUN } }, select: { id: true } })).map((r) => r.id);
    await prisma.podFlashSale.deleteMany({ where: { id: { in: ids } } });
    if (productIds.length > 0) await prisma.podProduct.deleteMany({ where: { id: { in: productIds } } });
    await prisma.podTiktokShop.delete({ where: { id: shop2.id } });
    if (priorConfig) {
      const { id, ...rest } = priorConfig;
      await prisma.podFlashSaleAutoConfig.update({ where: { id }, data: { ...rest, lastRunSummary: rest.lastRunSummary ?? undefined } as never });
    } else {
      await prisma.podFlashSaleAutoConfig.deleteMany({ where: { organizationId: org } });
    }
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
