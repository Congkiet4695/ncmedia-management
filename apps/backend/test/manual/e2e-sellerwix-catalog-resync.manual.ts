/**
 * Đồng bộ LẠI danh mục Sellerwix bằng tài khoản thật trong DB và kiểm tính IDEMPOTENT: chạy nhiều lần
 * không sinh bản ghi trùng (upsert theo id phía nhà cung cấp). Chỉ ĐỌC phía Sellerwix.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/e2e-sellerwix-catalog-resync.manual.ts
 * Không cần backend chạy (dùng thẳng service của module). Danh mục ~1.000 sản phẩm ⇒ ~25 phút.
 */
import { NestFactory } from '@nestjs/core';
import { FulfillmentTrigger } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { FulfillmentCatalogSyncService } from '../../src/modules/fulfillment/services/fulfillment-catalog-sync.service';

async function counts(prisma: PrismaService, accountId: string) {
  const [row] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(
    `SELECT (SELECT count(*) FROM fulfillment_catalogues WHERE account_id=$1::uuid)::int catalogues,
            (SELECT count(*) FROM fulfillment_products WHERE account_id=$1::uuid)::int products,
            (SELECT count(*) FROM fulfillment_variants WHERE account_id=$1::uuid)::int variants,
            (SELECT count(*) FROM (SELECT sku FROM fulfillment_variants WHERE account_id=$1::uuid GROUP BY sku HAVING count(*) > 1) d)::int dup_variants,
            (SELECT count(*) FROM (SELECT external_product_id FROM fulfillment_products WHERE account_id=$1::uuid GROUP BY external_product_id HAVING count(*) > 1) d)::int dup_products`,
    accountId,
  );
  return row;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const account = await prisma.fulfillmentAccount.findFirstOrThrow({ where: { provider: 'SELLERWIX', deletedAt: null } });
  const before = await counts(prisma, account.id);
  console.log('Trước:', before);
  const started = Date.now();
  const result = await app
    .get(FulfillmentCatalogSyncService)
    .syncAccount(account.organizationId, account.id, FulfillmentTrigger.MANUAL);
  console.log(`Đồng bộ xong sau ${Math.round((Date.now() - started) / 1000)}s:`, {
    catalogues: result.catalogues,
    products: result.products,
    variants: result.variants,
    complete: result.complete,
    warnings: result.warnings.slice(0, 3),
  });
  const after = await counts(prisma, account.id);
  console.log('Sau:', after);
  const ok =
    after.dup_variants === 0 &&
    after.dup_products === 0 &&
    after.catalogues === before.catalogues &&
    after.products === before.products &&
    after.variants === before.variants;
  console.log(ok ? '✅ IDEMPOTENT: đồng bộ lại không sinh bản ghi trùng' : '⚠️ Số bản ghi thay đổi — xem chi tiết ở trên (danh mục nhà cung cấp có thể vừa đổi)');
  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('LỖI:', (error as Error).message);
  process.exit(1);
});
