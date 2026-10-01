/**
 * Chẩn đoán Shipping Method của Sellerwix bằng tài khoản THẬT trong DB + API THẬT — CHỈ ĐỌC.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/probe-sellerwix-shipping.manual.ts [variantSku]
 *
 * Không ghi DB: ánh xạ sản phẩm → biến thể Sellerwix được dựng TRONG BỘ NHỚ cho đúng đơn đang xét,
 * nên ánh xạ thật của tổ chức (đang trỏ Mango) không bị đụng tới. Không in API key / token.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { SellerwixApiClient } from '../../src/modules/fulfillment/sellerwix/clients/sellerwix-api.client';
import { SellerwixCredentialService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-credential.service';
import { SellerwixFulfillmentService } from '../../src/modules/fulfillment/sellerwix/services/sellerwix-fulfillment.service';
import { PodOrderRepository } from '../../src/modules/pod-tiktok/repositories/pod-order.repository';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const account = await prisma.fulfillmentAccount.findFirstOrThrow({
    where: { provider: 'SELLERWIX', deletedAt: null },
  });
  console.log('\n== Provider DB record');
  console.log({
    id: account.id,
    provider: account.provider,
    isActive: account.isActive,
    isGlobal: account.isGlobal,
    organizationId: account.organizationId,
    baseUrl: account.baseUrlOverride ?? '(mặc định cấu hình hệ thống)',
    credentialsConfigured: Boolean(account.apiKeyEnc),
    storeIdConfigured: Boolean((account.providerConfig as { storeId?: string } | null)?.storeId),
  });

  const counts = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(
    `SELECT (SELECT count(*) FROM fulfillment_products WHERE account_id=$1::uuid)::int products,
            (SELECT count(*) FROM fulfillment_variants WHERE account_id=$1::uuid)::int variants,
            (SELECT count(*) FROM fulfillment_variants WHERE account_id=$1::uuid AND status='ACTIVE')::int active_variants,
            (SELECT max(finished_at)::text FROM fulfillment_sync_logs WHERE account_id=$1::uuid AND status='SUCCESS') last_sync`,
    account.id,
  );
  console.log('\n== Master data', counts[0]);

  const sku =
    process.argv[2] ??
    (
      await prisma.fulfillmentVariant.findFirstOrThrow({
        where: { accountId: account.id, status: 'ACTIVE', deletedAt: null, sku: { startsWith: 'SW-GM-' } },
        orderBy: { sku: 'asc' },
      })
    ).sku;

  console.log(`\n== API thật: GET shipping methods của biến thể ${sku}`);
  const ctx = app.get(SellerwixCredentialService).buildContext(account);
  const raw = await app.get(SellerwixApiClient).listShippingMethods(ctx, sku);
  const list = Array.isArray(raw.data) ? raw.data : (raw.data as { data?: unknown[] })?.data;
  console.log({
    httpStatus: raw.httpStatus,
    durationMs: raw.durationMs,
    shape: Array.isArray(raw.data) ? 'array' : typeof raw.data === 'object' ? `object{${Object.keys(raw.data ?? {}).join(',')}}` : typeof raw.data,
    count: Array.isArray(list) ? list.length : null,
    sample: Array.isArray(list) ? list.slice(0, 3) : raw.data,
  });

  console.log('\n== Luồng backend (SellerwixFulfillmentService.shippingMethods) với một đơn thật');
  const order = await prisma.podOrder.findFirstOrThrow({
    where: { organizationId: account.organizationId, items: { some: {} } },
    orderBy: { orderedAt: 'desc' },
    select: { id: true },
  });
  const full = await app.get(PodOrderRepository).findById(account.organizationId, order.id);
  const mappings = (full?.items ?? []).map((item) => ({
    id: `in-memory-${item.id}`,
    accountId: account.id,
    provider: account.provider,
    tiktokProductId: item.productId,
    sellerSku: item.sellerSku,
    providerSku: sku,
    isActive: true,
  }));
  const result = await app
    .get(SellerwixFulfillmentService)
    .shippingMethods(account, full!, mappings as never);
  console.log({ orderId: order.id, recipientRegion: full?.recipientRegionCode, options: result.options, warnings: result.warnings });
  const uuidLike = result.options.filter((o) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(o.label));
  console.log(`dropdown options: ${result.options.length} · nhãn dạng UUID: ${uuidLike.length}`);

  await app.close();
}

main().catch((error) => {
  console.error('LỖI:', (error as Error).message);
  process.exit(1);
});
