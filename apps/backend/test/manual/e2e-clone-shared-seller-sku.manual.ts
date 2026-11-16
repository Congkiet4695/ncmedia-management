/**
 * **Clone Product — Seller SKU dùng chung (lỗi thật 2026-11-14)** — kiểm trên Postgres THẬT, không mock.
 *
 * Sản phẩm nguồn dùng MỘT Seller SKU cho cả 168 biến thể (TikTok nhận; ~19.7k sản phẩm production như vậy). Trước
 * bản sửa, lượt nhân bản chép nguyên mã ⇒ `podListingPayloadItem.createMany()` vỡ `(payload_id, seller_sku)`.
 *
 * Chạy đúng đường code của job CLONE: `PodProductCloneResolverService.loadSource → resolve →
 * PodListingPayloadService.saveClone → persist → createMany`. KHÔNG gọi TikTok.
 *
 * CHỈ chạy trên database thử dùng một lần (từ chối mọi host khác 127.0.0.1:55432):
 *   DATABASE_URL=postgresql://ncm_test@127.0.0.1:55432/ncm_shot node -r ts-node/register test/manual/e2e-clone-shared-seller-sku.manual.ts
 */
import { PodListingMarket, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/database/prisma.service';
import { PodListingPayloadService } from '../../src/modules/pod-listing/services/pod-listing-payload.service';
import { PodProductCloneResolverService } from '../../src/modules/pod-listing/services/pod-product-clone-resolver.service';

const url = process.env.DATABASE_URL ?? '';
if (!/@127\.0\.0\.1:55432\//.test(url)) throw new Error('Chỉ chạy trên database thử 127.0.0.1:55432');

const prisma = new PrismaClient();
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

const SHARED_SKU = 'HOANGTHITRAMY148_BRBF_11092026_283';
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const COLORS = ['ASH', 'Black', 'Dark Chocolate', 'Forest Green', 'Light Pink', 'Maroon', 'Navy'];

async function main() {
  const [source, target] = await prisma.podTiktokShop.findMany({
    where: { deletedAt: null },
    select: { id: true, accountId: true, organizationId: true, name: true, region: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  if (!source || !target) throw new Error('Cần ít nhất 2 shop trong database thử');
  const organizationId = source.organizationId;

  // Sản phẩm nguồn y hệt dạng production: 168 biến thể, MỘT Seller SKU.
  const product = await prisma.podProduct.create({
    data: {
      organizationId,
      accountId: source.accountId,
      shopId: source.id,
      tiktokProductId: `E2E-CLONE-${Date.now()}`,
      payloadHash: '0'.repeat(64),
      title: 'E2E shared Seller SKU tee',
      variants: {
        create: Array.from({ length: 168 }, (_, index) => ({
          organizationId,
          tiktokSkuId: `E2E-SKU-${index}`,
          sellerSku: SHARED_SKU,
          variantName: `${1 + Math.floor(index / 42)} / ${SIZES[index % 6]} / ${COLORS[Math.floor(index / 6) % 7]}`,
          salePrice: new Prisma.Decimal('19.99'),
          currency: 'USD',
          inventoryTotal: 10,
        })),
      },
    },
    select: { id: true, updatedAt: true },
  });

  const cloneResolver = new PodProductCloneResolverService(prisma as unknown as PrismaService);
  const payloads = new PodListingPayloadService(
    prisma as unknown as PrismaService,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const runClone = async () => {
    const loaded = await cloneResolver.loadSource(organizationId, product.id);
    if (!loaded) throw new Error('Không nạp được sản phẩm nguồn');
    const resolved = cloneResolver.resolve(loaded, target, PodListingMarket.US, null);
    const saved = await payloads.saveClone(organizationId, null, {
      productId: product.id,
      shop: { id: target.id, accountId: target.accountId },
      resolved,
    });
    return { saved, resolved };
  };
  const itemsOf = (payloadId: string) =>
    prisma.podListingPayloadItem.findMany({ where: { payloadId }, orderBy: { sortOrder: 'asc' } });

  // ---- C1: tái hiện lỗi cũ trên DB thật (input như resolver CŨ: chép nguyên mã) ⇒ P2002 và rollback trọn ----
  const before = await prisma.podListingPayload.count({ where: { productId: product.id } });
  const loaded = await cloneResolver.loadSource(organizationId, product.id);
  const legacy = cloneResolver.resolve(loaded!, target, PodListingMarket.US, null);
  legacy.payload.variants = legacy.payload.variants.map((variant) => ({ ...variant, sellerSku: SHARED_SKU }));
  const legacyError = await payloads
    .saveClone(organizationId, null, { productId: product.id, shop: target, resolved: legacy })
    .then(() => null)
    .catch((error: unknown) => error);
  const after = await prisma.podListingPayload.count({ where: { productId: product.id } });
  check(
    'C1 Tái hiện lỗi gốc: chép nguyên Seller SKU dùng chung ⇒ unique (payload_id, seller_sku) vỡ, transaction rollback (không payload mồ côi)',
    legacyError instanceof Prisma.PrismaClientKnownRequestError && legacyError.code === 'P2002' && before === 0 && after === 0,
    `${legacyError instanceof Prisma.PrismaClientKnownRequestError ? `${legacyError.code} ${JSON.stringify(legacyError.meta?.target)}` : String(legacyError)} · payload trước/sau ${before}/${after}`,
  );

  // ---- C2: nhân bản bằng code đã sửa ⇒ thành công, 168 item, 168 mã khác nhau ----
  const first = await runClone();
  const items1 = await itemsOf(first.saved.id);
  const skus1 = items1.map((item) => item.sellerSku);
  check(
    'C2 Nhân bản sản phẩm 168 biến thể dùng chung 1 Seller SKU ⇒ lưu được, 168 payload item, 168 Seller SKU khác nhau',
    first.saved.created && items1.length === 168 && new Set(skus1).size === 168,
    `payload ${first.saved.id} · item ${items1.length} · mã khác nhau ${new Set(skus1).size} · ví dụ ${skus1[0]}`,
  );
  check(
    'C3 Cảnh báo (không phải lỗi chặn) nêu việc đổi mã; mọi item thuộc ĐÚNG payload mới',
    first.resolved.issues.some((issue) => issue.code === 'DRAFT_SELLER_SKU_DERIVED' && issue.level === 'WARNING') &&
      items1.every((item) => item.payloadId === first.saved.id && item.organizationId === organizationId),
    first.resolved.issues.find((issue) => issue.code === 'DRAFT_SELLER_SKU_DERIVED')?.message.slice(0, 120) ?? '',
  );

  // ---- C4: nhân bản lại cùng cặp ⇒ ghi đè ĐÚNG payload đó, cùng bộ mã (tất định), không crash ----
  const second = await runClone();
  const items2 = await itemsOf(second.saved.id);
  check(
    'C4 Nhân bản lại cùng sản phẩm → cùng shop ⇒ ghi đè đúng payload cũ, vẫn 168 item, CÙNG bộ Seller SKU',
    !second.saved.created &&
      second.saved.id === first.saved.id &&
      items2.length === 168 &&
      JSON.stringify(items2.map((item) => item.sellerSku)) === JSON.stringify(skus1),
    `created=${second.saved.created} · item ${items2.length}`,
  );

  // ---- C5: hai lượt đồng thời trên cùng payload (job đã chặn bằng findInProgress; đây là kiểm tầng DB) ----
  const concurrent = await Promise.allSettled([runClone(), runClone()]);
  const items3 = await itemsOf(first.saved.id);
  const payloadCount = await prisma.podListingPayload.count({ where: { productId: product.id, shopId: target.id } });
  check(
    'C5 Hai lượt nhân bản đồng thời cùng cặp ⇒ dữ liệu không hỏng: 1 payload, 168 item, không trùng mã',
    payloadCount === 1 && items3.length === 168 && new Set(items3.map((item) => item.sellerSku)).size === 168,
    `kết quả: ${concurrent.map((outcome) => (outcome.status === 'fulfilled' ? 'OK' : `LỖI ${(outcome.reason as Error).message.split('\n').pop()?.slice(0, 80)}`)).join(' | ')} · payload ${payloadCount} · item ${items3.length}`,
  );

  // ---- C6: sản phẩm nguồn KHÔNG đổi ----
  const sourceAfter = await prisma.podProduct.findUnique({
    where: { id: product.id },
    select: { updatedAt: true, variants: { select: { sellerSku: true } } },
  });
  check(
    'C6 Sản phẩm nguồn giữ nguyên (168 biến thể, Seller SKU gốc, updated_at không đổi)',
    sourceAfter!.updatedAt.getTime() === product.updatedAt.getTime() &&
      sourceAfter!.variants.length === 168 &&
      sourceAfter!.variants.every((variant) => variant.sellerSku === SHARED_SKU),
  );

  // ---- C7: toàn vẹn toàn bảng ----
  const [dups, orphans] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) n from (select payload_id, seller_sku from pod_listing_payload_items group by 1,2 having count(*) > 1) d`,
    prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) n from pod_listing_payload_items i left join pod_listing_payloads p on p.id = i.payload_id where p.id is null`,
  ]);
  check(
    'C7 Toàn vẹn: không cặp (payload_id, seller_sku) trùng, không payload item mồ côi',
    Number(dups[0].n) === 0 && Number(orphans[0].n) === 0,
    `trùng ${dups[0].n} · mồ côi ${orphans[0].n}`,
  );

  // Dọn dữ liệu thử của chính lượt này.
  await prisma.podListingPayload.deleteMany({ where: { productId: product.id } });
  await prisma.podProduct.delete({ where: { id: product.id } });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed · run ${randomUUID().slice(0, 8)}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
