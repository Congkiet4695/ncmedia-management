/* eslint-disable */
/**
 * Thăm dò READ-ONLY: SKU mà một đợt Flash Sale sẽ gửi lên TikTok có thực sự còn "sống" trên
 * TikTok (đúng shop, đúng sản phẩm, sản phẩm ACTIVATE) hay không.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/probe-flash-sale-sku-validity.manual.ts [flashSaleId|tên]
 * Bỏ trống ⇒ đợt sale chưa xoá mới nhất. KHÔNG ghi database, KHÔNG gọi API khuyến mãi.
 * Tốn 1 lời gọi Get Product cho mỗi sản phẩm TikTok khác nhau của đợt.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PodTiktokShopContextService } from '../../src/modules/pod-tiktok/services/pod-tiktok-shop-context.service';
import { TiktokProductApiService } from '../../src/modules/tiktok-sdk/tiktok-product-api.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const arg = process.argv[2];
  const fs = await prisma.podFlashSale.findFirstOrThrow({
    where: {
      deletedAt: null,
      ...(arg ? (/^[0-9a-f-]{36}$/i.test(arg) ? { id: arg } : { name: arg }) : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        where: { status: { not: 'REMOVED' } },
        include: {
          product: { select: { tiktokProductId: true, status: true, auditStatus: true, deactivatedAt: true, shopId: true } },
          variant: { select: { tiktokSkuId: true, productId: true } },
        },
      },
    },
  });
  console.log(`Flash Sale "${fs.name}" (${fs.status}, ${fs.productLevel}) — ${fs.items.length} dòng`);

  const ctx = await app.get(PodTiktokShopContextService).resolve(fs.organizationId, fs.shopId);
  const api = app.get(TiktokProductApiService);
  const productIds = [...new Set(fs.items.map((i) => i.providerProductId).filter(Boolean))] as string[];

  let badItems = 0;
  for (const productId of productIds) {
    const items = fs.items.filter((i) => i.providerProductId === productId);
    const local = items[0].product;
    let remote: { status?: string; skus: Set<string>; error?: string };
    try {
      const { data } = await api.getProduct(ctx, productId);
      remote = { status: (data as any).status, skus: new Set(((data as any).skus ?? []).map((s: any) => s.id)) };
    } catch (e: any) {
      remote = { skus: new Set(), error: `${e.tiktokCode ?? ''} ${e.tiktokMessage ?? e.message}` };
    }
    const missing = items.filter((i) => i.providerVariantId && !remote.skus.has(i.providerVariantId));
    const live = remote.status === 'ACTIVATE';
    if (!live || missing.length) badItems += live ? missing.length : items.length;
    console.log(
      `${live && !missing.length ? '✅' : '❌'} product ${productId} | local ${local.status}/${local.auditStatus}` +
        `${local.deactivatedAt ? ' deactivated' : ''} | TikTok ${remote.error ?? remote.status} | ` +
        `${items.length} dòng, SKU không còn trên sản phẩm: ${missing.length}`,
    );
  }
  console.log(`\nTổng: ${productIds.length} sản phẩm, ${badItems} dòng sẽ bị TikTok từ chối.`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
