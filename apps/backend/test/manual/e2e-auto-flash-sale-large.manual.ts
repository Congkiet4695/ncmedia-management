/**
 * Kiểm chứng trên DATABASE THẬT (local) transaction tạo đợt kế tiếp của Auto Flash Sale với đợt LỚN:
 *
 *   A. Đợt A 10.000 SKU (dữ liệu tạm) ⇒ hai lượt Auto chạy SONG SONG ⇒ đúng MỘT đợt B, đủ 10.000 dòng,
 *      không trùng dòng, không "Transaction already closed".
 *   B. Đợt A' đang bị transaction khác giữ khoá hàng ⇒ lượt Auto bỏ qua NHANH (lock_timeout), không lỗi,
 *      không tạo B'.
 *
 * TikTok KHÔNG được gọi: publisher là stub (đợt B dừng ở trạng thái local). Dữ liệu tạm được dọn.
 * Chạy: node -r ts-node/register -r dotenv/config test/manual/e2e-auto-flash-sale-large.manual.ts
 */
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PodFlashSaleItemStatus, PodFlashSaleStatus, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PodFlashSaleAutoService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale-auto.service';
import { PodFlashSaleService } from '../../src/modules/pod-flash-sale/services/pod-flash-sale.service';
import { DistributedLockService } from '../../src/modules/pod-tiktok/infra/distributed-lock.service';

const SKUS = 10_000;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => void job.stop());
  const prisma = app.get(PrismaService);
  const results: Array<[string, boolean, string]> = [];
  const check = (label: string, ok: boolean, detail: unknown) => results.push([label, ok, JSON.stringify(detail)]);
  const created: string[] = [];

  const template = await prisma.podFlashSale.findFirstOrThrow({ include: { items: { take: 1 } } });
  const sampleItem = template.items[0];
  if (!sampleItem) throw new Error('Cần một Flash Sale có ít nhất một dòng làm mẫu');
  const variants = await prisma.podProductVariant.findMany({
    where: { organizationId: template.organizationId, deletedAt: null },
    select: { id: true, productId: true, tiktokSkuId: true },
    take: SKUS,
  });
  if (variants.length < SKUS) throw new Error(`Chỉ có ${variants.length} biến thể — cần ${SKUS}`);

  const now = new Date();
  const makeSource = async (name: string, count: number) => {
    const sale = await prisma.podFlashSale.create({
      data: {
        organizationId: template.organizationId,
        accountId: template.accountId,
        shopId: template.shopId,
        provider: template.provider,
        name,
        status: PodFlashSaleStatus.RUNNING,
        productLevel: 'VARIATION',
        startAt: new Date(now.getTime() - 3_600_000),
        endAt: new Date(now.getTime() + 2 * 3_600_000),
        timezone: 'UTC',
        itemCount: count,
        autoMode: true,
        autoChainId: randomUUID(),
        autoSequence: 1,
      },
      select: { id: true },
    });
    created.push(sale.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- bỏ các cột sinh tự động khỏi bản sao
    const { id: _id, createdAt: _c, updatedAt: _u, flashSaleId: _f, ...row } = sampleItem;
    for (let offset = 0; offset < count; offset += 1_000) {
      await prisma.podFlashSaleItem.createMany({
        data: variants.slice(offset, Math.min(offset + 1_000, count)).map((variant, index) => ({
          ...(row as unknown as Prisma.PodFlashSaleItemCreateManyInput),
          flashSaleId: sale.id,
          productId: variant.productId,
          variantId: variant.id,
          skuId: variant.tiktokSkuId,
          providerSkuId: variant.tiktokSkuId,
          status: PodFlashSaleItemStatus.PUBLISHED,
          sortOrder: offset + index,
        })),
      });
    }
    return prisma.podFlashSale.findUniqueOrThrow({ where: { id: sale.id } });
  };

  const publisher = {
    publish: () => Promise.resolve({}),
    retry: () => Promise.resolve({}),
    whenPublishIdle: () => Promise.resolve(),
    describeFailure: (error: Error) => ({ code: null, message: error.message, requestId: null }),
  };
  const auto = new PodFlashSaleAutoService(prisma, app.get(PodFlashSaleService), publisher as never, app.get(DistributedLockService));

  try {
    // ------------------------------------------------------------- A. 10.000 SKU, hai lượt song song
    const source = await makeSource(`E2E-AUTO-${Date.now()}`, SKUS);
    const started = Date.now();
    const outcomes = await Promise.all([
      auto.processNode(source as never, now, 3, 'e2e-run-1').catch((error: Error) => ({ action: 'THROWN', message: error.message })),
      auto.processNode(source as never, now, 3, 'e2e-run-2').catch((error: Error) => ({ action: 'THROWN', message: error.message })),
    ]);
    const elapsedMs = Date.now() - started;
    const children = await prisma.podFlashSale.findMany({ where: { autoParentId: source.id }, select: { id: true, itemCount: true } });
    created.push(...children.map((child) => child.id));
    const childItems = children[0] ? await prisma.podFlashSaleItem.count({ where: { flashSaleId: children[0].id } }) : 0;
    const distinctVariants = children[0]
      ? (await prisma.podFlashSaleItem.groupBy({ by: ['variantId'], where: { flashSaleId: children[0].id } })).length
      : 0;
    check('A1 không lượt nào ném "Transaction already closed"', outcomes.every((outcome) => outcome.action !== 'THROWN'), outcomes.map((o) => o.action));
    check('A2 hai lượt song song ⇒ đúng MỘT đợt kế tiếp', children.length === 1, children.length);
    check('A3 đợt kế tiếp đủ 10.000 dòng, không trùng biến thể', childItems === SKUS && distinctVariants === SKUS, { childItems, distinctVariants, itemCount: children[0]?.itemCount });
    check('A4 thời gian cả lượt (2 tiến trình, 10.000 dòng)', true, { elapsedMs });

    // Chạy lại lần nữa: đã có B ⇒ không tạo thêm.
    await auto.processNode(source as never, now, 3, 'e2e-run-3').catch(() => undefined);
    const again = await prisma.podFlashSale.count({ where: { autoParentId: source.id } });
    check('A5 chạy lại ⇒ vẫn đúng một đợt kế tiếp', again === 1, again);

    // ------------------------------------------------------------- B. Đợt nguồn đang bị giữ khoá
    const locked = await makeSource(`E2E-AUTO-LOCK-${Date.now()}`, 50);
    let release: () => void = () => undefined;
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM pod_flash_sales WHERE id = ${locked.id}::uuid FOR UPDATE`;
        await new Promise<void>((resolve) => {
          release = resolve;
          setTimeout(resolve, 15_000);
        });
      },
      { timeout: 30_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const lockStarted = Date.now();
    const lockOutcome = await auto
      .processNode(locked as never, now, 3, 'e2e-run-lock')
      .catch((error: Error) => ({ action: 'THROWN', message: error.message }));
    const lockMs = Date.now() - lockStarted;
    release();
    await holder;
    const lockedChildren = await prisma.podFlashSale.count({ where: { autoParentId: locked.id } });
    check('B1 đợt nguồn bị giữ khoá ⇒ SKIPPED nhanh (≈ lock_timeout), không lỗi, không tạo đợt kế tiếp', lockOutcome.action === 'SKIPPED' && lockedChildren === 0 && lockMs < 10_000, {
      action: lockOutcome.action,
      message: (lockOutcome as { message?: string | null }).message,
      lockMs,
    });
  } finally {
    await prisma.podFlashSaleLog.deleteMany({ where: { flashSaleId: { in: created } } });
    await prisma.podFlashSaleItem.deleteMany({ where: { flashSaleId: { in: created } } });
    // Con trước cha (khoá ngoại auto_parent_id).
    await prisma.podFlashSale.deleteMany({ where: { id: { in: created }, autoParentId: { not: null } } });
    await prisma.podFlashSale.deleteMany({ where: { id: { in: created } } });
    await app.close();
  }

  for (const [label, ok, detail] of results) console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  console.log('Đã dọn dữ liệu tạm.');
  if (results.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
