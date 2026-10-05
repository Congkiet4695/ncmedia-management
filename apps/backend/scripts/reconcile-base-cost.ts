/**
 * Đối soát GIÁ VỐN của đơn ĐÃ gửi (mọi nhà cung cấp) nhưng chưa có giá vốn / đơn vị tiền xác nhận.
 *
 * Vì sao cần: bộ đồng bộ định kỳ chỉ hỏi lại đơn CHƯA kết thúc (`findOrdersToSync`). Đơn đã SHIPPED
 * trước bản vá "Sellerwix base cost" vẫn mang `fulfillment_orders.currency = NULL` (⇒ Lợi nhuận báo
 * COST_CURRENCY_UNKNOWN, Dashboard bỏ Basecost) hoặc dòng hàng chưa `base_cost_confirmed_at`.
 *
 * Nguồn sự thật: CHÍNH nhà cung cấp (Get Order Detail — Mango `items[].base_cost`, Sellerwix
 * `line_items[].item_cost`). Script KHÔNG tự tính, KHÔNG chép giá catalog, KHÔNG lấy giá bán TikTok —
 * nó gọi đúng đường `FulfillmentProviderGateway.syncOne` mà scheduler / webhook dùng, nên mọi luật
 * (ghép dòng, không ghi đè số đã có bằng NULL, đơn vị tiền) giữ nguyên. Đơn nhà cung cấp không trả giá
 * ⇒ còn "chờ báo giá" ⇒ Admin nhập tay ở cột Fulfillment (PATCH /fulfillment/orders/:id/base-cost).
 *
 * Mặc định CHỈ LIỆT KÊ (dry-run). Ghi thật phải truyền `--apply`.
 *
 * Chạy:
 *   node -r ts-node/register -r dotenv/config scripts/reconcile-base-cost.ts            # dry-run
 *   node -r ts-node/register -r dotenv/config scripts/reconcile-base-cost.ts --apply    # ghi
 *   … --provider SELLERWIX|MANGO --org <organizationId> --limit 50
 *
 * Hạn mức API do client của từng nhà cung cấp tự giãn (Sellerwix: 15 req/phút ⇒ ~4 giây / đơn).
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { FulfillmentProvider, FulfillmentTrigger, Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { FulfillmentProviderGateway } from '../src/modules/fulfillment/services/fulfillment-provider.gateway';
import { NON_BLOCKING_FULFILLMENT_STATUSES } from '../src/modules/fulfillment/shared/fulfillment-lifecycle';
import { productCostOf } from '../src/modules/fulfillment/shared/product-cost';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const organizationId = argValue('--org');
  const providerArg = argValue('--provider')?.toUpperCase();
  if (providerArg && !(providerArg in FulfillmentProvider)) throw new Error(`--provider không hợp lệ: ${providerArg}`);
  const provider = providerArg as FulfillmentProvider | undefined;
  const limit = Number(argValue('--limit') ?? 200);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit phải là số nguyên ≥ 1');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  // Script dùng chung AppModule với server ⇒ TẮT mọi job định kỳ trong tiến trình này: lượt đối soát
  // dài (~4 giây/đơn) không được chạy song song scheduler của server (đồng bộ đơn, Flash Sale…).
  const scheduler = app.get(SchedulerRegistry);
  scheduler.getCronJobs().forEach((job) => void job.stop());
  scheduler.getIntervals().forEach((name) => scheduler.deleteInterval(name));
  scheduler.getTimeouts().forEach((name) => scheduler.deleteTimeout(name));
  try {
    const prisma = app.get(PrismaService);
    const gateway = app.get(FulfillmentProviderGateway);

    const where: Prisma.FulfillmentOrderWhereInput = {
      ...(provider ? { provider } : {}),
      deletedAt: null,
      providerOrderId: { not: null },
      status: { notIn: [...NON_BLOCKING_FULFILLMENT_STATUSES] },
      ...(organizationId ? { organizationId } : {}),
      OR: [{ currency: null }, { items: { some: { deletedAt: null, baseCostConfirmedAt: null } } }],
    };
    const candidates = await prisma.fulfillmentOrder.findMany({
      where,
      include: { items: { where: { deletedAt: null } }, account: true },
      orderBy: { submittedAt: 'asc' },
      take: limit,
    });
    const total = await prisma.fulfillmentOrder.count({ where });

    console.log(
      `${apply ? 'APPLY' : 'DRY-RUN'} — ${total} đơn cần đối soát giá vốn` +
        (total > candidates.length ? ` (xử lý ${candidates.length} đơn đầu, dùng --limit)` : ''),
    );

    const summary = { checked: 0, confirmed: 0, stillPending: 0, failed: 0 };
    for (const record of candidates) {
      const before = productCostOf(record.submittedAt !== null, record.items);
      const line = {
        fulfillmentOrderId: record.id,
        provider: record.provider,
        podOrderId: record.podOrderId,
        providerOrderId: record.providerOrderId,
        status: record.status,
        currency: record.currency,
        productCost: before.productCost,
        confirmed: before.productCostConfirmed,
      };
      if (!apply) {
        console.log(JSON.stringify(line));
        continue;
      }

      summary.checked += 1;
      if (!gateway.isSupported(record.provider)) {
        console.log(JSON.stringify({ ...line, skipped: 'PROVIDER_NOT_SUPPORTED' }));
        continue;
      }
      await gateway.syncOne(record, record.account, FulfillmentTrigger.MANUAL);
      const fresh = await prisma.fulfillmentOrder.findUniqueOrThrow({
        where: { id: record.id },
        include: { items: { where: { deletedAt: null } } },
      });
      const after = productCostOf(fresh.submittedAt !== null, fresh.items);
      const ok = after.productCostConfirmed && fresh.currency !== null;
      if (ok) summary.confirmed += 1;
      else if (fresh.lastErrorCode && fresh.lastErrorCode !== record.lastErrorCode)
        summary.failed += 1;
      else summary.stillPending += 1;
      console.log(
        JSON.stringify({
          ...line,
          after: {
            currency: fresh.currency,
            productCost: after.productCost,
            confirmed: after.productCostConfirmed,
          },
          lastErrorCode: fresh.lastErrorCode,
        }),
      );
    }
    if (apply) console.log('Kết quả:', summary);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
