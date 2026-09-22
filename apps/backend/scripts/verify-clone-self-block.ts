/**
 * Kiểm chứng trên DATABASE THẬT (local) nguyên nhân gốc của lỗi
 * "[CLONE_SKIPPED] Đang có một lượt nhân bản khác chạy cho shop này" ở 2/2 shop:
 *
 *   1. Tạo một lượt CLONE tạm với MỘT item cho cặp (sản phẩm, shop) rồi đánh PROCESSING —
 *      đúng như `claimReadyItems` làm trước khi pipeline chạy.
 *   2. Hỏi `findInProgress` KHÔNG loại chính item ⇒ thấy CHÍNH NÓ (đây là cách code cũ hỏi ⇒ tự chặn).
 *   3. Hỏi `findInProgress` CÓ loại chính item ⇒ null (cách code mới hỏi ⇒ chạy tiếp).
 *   4. `findSkipReason` không còn nhìn item đang chạy ⇒ null cho shop đích khác shop nguồn.
 *   5. Dọn dữ liệu tạm (chỉ xoá đúng job/item vừa tạo — không đụng lịch sử).
 *
 * Chạy: `node -r ts-node/register scripts/verify-clone-self-block.ts` (cần DATABASE_URL trong .env).
 */
import 'dotenv/config';
import { PodListingJobItemStatus, PodListingJobType, PrismaClient } from '@prisma/client';
import { PodProductCloneResolverService } from '../src/modules/pod-listing/services/pod-product-clone-resolver.service';
import type { PrismaService } from '../src/database/prisma.service';

async function main() {
  const prisma = new PrismaClient();
  const resolver = new PodProductCloneResolverService(prisma as unknown as PrismaService);

  const product = await prisma.podProduct.findFirst({
    where: { deletedAt: null },
    select: { id: true, organizationId: true, shopId: true, tiktokProductId: true },
  });
  if (!product) throw new Error('Không có sản phẩm nào trong DB để kiểm chứng.');
  // Shop đích của item tạm: shop bất kỳ khác shop nguồn nếu có, không thì dùng chính shop nguồn
  // (chỉ để kiểm câu hỏi "đang chạy?", không kiểm chống trùng).
  const target =
    (await prisma.podTiktokShop.findFirst({
      where: { organizationId: product.organizationId, deletedAt: null, id: { not: product.shopId } },
      select: { id: true },
    })) ?? { id: product.shopId };

  const job = await prisma.podListingJob.create({
    data: {
      organizationId: product.organizationId,
      name: '[verify-clone-self-block] lượt tạm — sẽ xoá',
      market: 'US',
      type: PodListingJobType.CLONE,
      totalItems: 1,
      items: {
        create: {
          organizationId: product.organizationId,
          productId: product.id,
          shopId: target.id,
          status: PodListingJobItemStatus.PROCESSING,
          startedAt: new Date(),
        },
      },
    },
    include: { items: true },
  });
  const item = job.items[0];
  const results: Array<[string, boolean, string]> = [];
  try {
    const seesItself = await resolver.findInProgress(product.organizationId, product.id, target.id);
    results.push([
      'Không loại chính item (cách hỏi CŨ) ⇒ query thấy CHÍNH item đang xử lý',
      seesItself?.itemId === item.id,
      JSON.stringify(seesItself),
    ]);

    const excluded = await resolver.findInProgress(product.organizationId, product.id, target.id, item.id);
    results.push(['Loại chính item (cách hỏi MỚI) ⇒ null — không tự chặn', excluded === null, JSON.stringify(excluded)]);

    const source = await resolver.loadSource(product.organizationId, product.id);
    if (!source) throw new Error('loadSource null');
    const skip = await resolver.findSkipReason(product.organizationId, source, '00000000-0000-4000-8000-000000000000');
    results.push(['findSkipReason không còn coi item đang chạy là lý do bỏ qua', skip === null, JSON.stringify(skip)]);
  } finally {
    await prisma.podListingJobItem.delete({ where: { id: item.id } });
    await prisma.podListingJob.delete({ where: { id: job.id } });
    await prisma.$disconnect();
  }

  let failed = 0;
  for (const [name, ok, detail] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  → ${detail}`);
    if (!ok) failed += 1;
  }
  console.log(`\nSản phẩm kiểm: ${product.tiktokProductId} · shop đích: ${target.id} · ${results.length - failed}/${results.length} PASS`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
