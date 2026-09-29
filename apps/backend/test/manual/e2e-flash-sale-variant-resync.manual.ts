/* eslint-disable */
/**
 * Kiểm thử TÍCH HỢP (database thật): đồng bộ lại sản phẩm KHÔNG được làm mất dòng Flash Sale.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-flash-sale-variant-resync.manual.ts
 *        (thêm REPO=<đường dẫn module repository> để chạy với một bản repository khác — dùng để
 *        tái hiện lỗi với bản trước khi sửa; kèm REPRO_CASCADE=1 để dựng lại FK CASCADE cũ)
 *
 * Kịch bản — đường đi THẬT, không mock:
 *   PodProductMapper.toWriteData ─▶ PodProductRepository.upsertAggregate ─▶ PostgreSQL
 *
 *   1. Đồng bộ một sản phẩm 3 SKU (A1, A2, A3).
 *   2. Tạo một Flash Sale mức VARIATION chứa cả 3 SKU (đúng các cột `addItems` ghi).
 *   3. Đồng bộ LẠI sản phẩm với payload đổi (giá mới) — tình huống xảy ra mỗi ngày.
 *      Kỳ vọng: Flash Sale vẫn đủ 3 dòng, `variant_id` KHÔNG đổi.
 *   4. Đồng bộ lại với A3 đã bị người bán xoá trên TikTok.
 *      Kỳ vọng: Flash Sale VẪN 3 dòng; dòng A3 mất `variant_id` nhưng giữ `provider_variant_id`
 *      + `sku_id` (FAILED ≠ DELETE) — validator sẽ báo lỗi cho dòng đó.
 *
 * Toàn bộ dữ liệu test tự dọn ở cuối (kể cả khi thất bại).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PodProductMapper } from '../../src/modules/pod-product/mappers/pod-product.mapper';

const repoModulePath =
  process.env.REPO ?? '../../src/modules/pod-product/repositories/pod-product.repository';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PodProductRepository } = require(repoModulePath);

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

function detail(tiktokProductId: string, skus: Array<{ id: string; seller: string; price: string }>) {
  return {
    id: tiktokProductId,
    title: `E2E resync ${tiktokProductId}`,
    status: 'ACTIVATE',
    skus: skus.map((sku) => ({
      id: sku.id,
      sellerSku: sku.seller,
      price: { salePrice: sku.price, currency: 'USD' },
      salesAttributes: [{ name: 'Size', valueName: sku.seller }],
    })),
  };
}

async function main(): Promise<void> {
  const shop = await prisma.podTiktokShop.findFirst({
    where: { deletedAt: null },
    select: { id: true, organizationId: true, accountId: true },
  });
  if (!shop) throw new Error('Cần ít nhất một shop TikTok trong database local');

  const mapper = new PodProductMapper();
  const repo = new PodProductRepository(prisma);
  const tiktokProductId = `E2E-${Date.now()}`;
  const skus = [
    { id: `${tiktokProductId}-A1`, seller: 'A1', price: '20.00' },
    { id: `${tiktokProductId}-A2`, seller: 'A2', price: '22.00' },
    { id: `${tiktokProductId}-A3`, seller: 'A3', price: '24.00' },
  ];
  let productId: string | null = null;
  let flashSaleId: string | null = null;
  // REPRO_CASCADE=1 ⇒ dựng lại ĐÚNG FK cũ (ON DELETE CASCADE) trong lúc chạy, để tái hiện lỗi gốc
  // với repository cũ. Luôn trả về SET NULL ở `finally`.
  const reproCascade = process.env.REPRO_CASCADE === '1';
  const setVariantFk = (action: 'CASCADE' | 'SET NULL') =>
    prisma.$executeRawUnsafe(
      `ALTER TABLE "pod_flash_sale_items" DROP CONSTRAINT "pod_flash_sale_items_variant_id_fkey", ` +
        `ADD CONSTRAINT "pod_flash_sale_items_variant_id_fkey" FOREIGN KEY ("variant_id") ` +
        `REFERENCES "pod_product_variants"("id") ON DELETE ${action} ON UPDATE CASCADE`,
    );

  try {
    if (reproCascade) await setVariantFk('CASCADE');
    const sync = (payload: ReturnType<typeof detail>) =>
      repo.upsertAggregate(
        shop.organizationId,
        shop.accountId,
        shop.id,
        mapper.toWriteData(payload as never, payload),
        null,
      );

    // 1. Đồng bộ lần đầu
    productId = (await sync(detail(tiktokProductId, skus))).id as string;
    const before = await prisma.podProductVariant.findMany({
      where: { productId },
      orderBy: { sellerSku: 'asc' },
    });
    check('đồng bộ lần đầu tạo 3 biến thể', before.length === 3);

    // 2. Flash Sale mức VARIATION chứa cả 3 SKU
    const flashSale = await prisma.podFlashSale.create({
      data: {
        organizationId: shop.organizationId,
        accountId: shop.accountId,
        shopId: shop.id,
        name: `E2E resync ${randomUUID().slice(0, 8)}`,
        startAt: new Date(Date.now() + 3_600_000),
        endAt: new Date(Date.now() + 7_200_000),
        itemCount: 3,
      },
    });
    flashSaleId = flashSale.id;
    await prisma.podFlashSaleItem.createMany({
      data: before.map((variant, index) => ({
        organizationId: shop.organizationId,
        flashSaleId: flashSale.id,
        productId: productId as string,
        variantId: variant.id,
        skuId: variant.sellerSku,
        originalPrice: variant.salePrice ?? 20,
        flashSalePrice: 10,
        discountPercent: 50,
        providerProductId: tiktokProductId,
        providerVariantId: variant.tiktokSkuId,
        status: 'PUBLISHED' as const,
        sortOrder: index,
      })),
    });

    // 3. Đồng bộ lại — giá đổi, SKU giữ nguyên
    await sync(detail(tiktokProductId, skus.map((sku) => ({ ...sku, price: '30.00' }))));
    const afterResync = await prisma.podFlashSaleItem.findMany({
      where: { flashSaleId: flashSale.id },
      orderBy: { sortOrder: 'asc' },
    });
    check(
      'đồng bộ lại sản phẩm: Flash Sale vẫn đủ 3 dòng',
      afterResync.length === 3,
      `${afterResync.length}/3 dòng`,
    );
    check(
      'đồng bộ lại sản phẩm: variant_id của các dòng KHÔNG đổi',
      afterResync.length === 3 &&
        afterResync.every((item, index) => item.variantId === before[index].id),
    );
    const variantsNow = await prisma.podProductVariant.findMany({ where: { productId } });
    check(
      'giá biến thể được cập nhật (upsert, không bỏ qua dữ liệu mới)',
      variantsNow.every((variant) => variant.salePrice?.toString() === '30'),
    );

    // 4. Người bán xoá SKU A3 trên TikTok
    await sync(detail(tiktokProductId, skus.slice(0, 2)));
    const afterRemoval = await prisma.podFlashSaleItem.findMany({
      where: { flashSaleId: flashSale.id },
      orderBy: { sortOrder: 'asc' },
    });
    const a3 = afterRemoval.find((item) => item.skuId === 'A3');
    check(
      'SKU bị xoá trên TikTok: Flash Sale vẫn 3 dòng (FAILED ≠ DELETE)',
      afterRemoval.length === 3,
      `${afterRemoval.length}/3 dòng`,
    );
    check(
      'dòng A3 mất variant_id nhưng giữ provider_variant_id + sku_id',
      Boolean(a3) && a3?.variantId === null && a3?.providerVariantId === `${tiktokProductId}-A3`,
    );
  } finally {
    if (reproCascade) await setVariantFk('SET NULL');
    if (flashSaleId) await prisma.podFlashSale.delete({ where: { id: flashSaleId } });
    if (productId) await prisma.podProduct.delete({ where: { id: productId } });
    results.push('INFO  đã dọn dữ liệu test');
  }
}

main()
  .catch((error) => results.push(`FAIL  lỗi không mong đợi — ${(error as Error).message}`))
  .finally(async () => {
    console.log(results.join('\n'));
    await prisma.$disconnect();
    process.exit(results.some((line) => line.startsWith('FAIL')) ? 1 : 0);
  });
