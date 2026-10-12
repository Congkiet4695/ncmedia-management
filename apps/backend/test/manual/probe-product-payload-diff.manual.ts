/* eslint-disable */
/**
 * CHỈ ĐỌC: so payload Get Product đã lưu (pod_product_raw_data) với payload lấy mới từ TikTok, liệt kê
 * đường dẫn JSON khác nhau — tìm trường "dao động" làm payload_hash đổi dù sản phẩm không đổi.
 * Không ghi DB, không refresh token (token sắp hết hạn ⇒ dừng), không dựng AppModule.
 * Chạy: node -r ts-node/register -r dotenv/config test/manual/probe-product-payload-diff.manual.ts <shopId> [limit]
 */
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import configuration from '../../src/config/configuration';
import { TikTokSdkService } from '../../src/modules/tiktok-sdk/tiktok-sdk.service';
import { TiktokProductApiService } from '../../src/modules/tiktok-sdk/tiktok-product-api.service';
import { TiktokEncryptionService } from '../../src/modules/pod-tiktok/services/tiktok-encryption.service';

function diff(a: any, b: any, path: string, out: Map<string, number>) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], `${path}.${Array.isArray(a) ? '[]' : key}`, out);
    return;
  }
  out.set(path, (out.get(path) ?? 0) + 1);
  if (typeof a === 'string' && typeof b === 'string' && samples.length < 3) samples.push({ path, before: shape(a), after: shape(b) });
}

/** Host + path + TÊN tham số (không giá trị) — đủ để thấy URL đổi ở đâu, không in giá trị nhạy cảm. */
function shape(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname} ?${[...u.searchParams.keys()].join('&')}`;
  } catch {
    return '(không phải URL)';
  }
}
const samples: Array<{ path: string; before: string; after: string }> = [];

async function main() {
  const [shopId, limitArg] = process.argv.slice(2);
  const prisma = new PrismaClient();
  const config = new ConfigService(configuration());
  const shop = await prisma.podTiktokShop.findUniqueOrThrow({ where: { id: shopId }, include: { account: true } });
  if (shop.account.accessTokenExpiresAt.getTime() < Date.now() + 15 * 60_000) throw new Error('token sắp hết hạn — dừng');
  const sdk = new TikTokSdkService(config); sdk.onModuleInit();
  (sdk as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  const api = new TiktokProductApiService(sdk, config);
  const enc = new TiktokEncryptionService(config);
  const ctx = { accessToken: enc.decrypt(shop.account.accessTokenEnc), shopCipher: enc.decrypt(shop.shopCipherEnc), shopId, organizationId: shop.organizationId };
  const raws = await prisma.podProductRawData.findMany({ where: { shopId, source: 'DETAIL' }, orderBy: { fetchedAt: 'desc' }, take: Number(limitArg ?? 5), select: { tiktokProductId: true, payload: true, fetchedAt: true } });
  const paths = new Map<string, number>();
  let identical = 0;
  for (const raw of raws) {
    const { data } = await api.getProduct(ctx, raw.tiktokProductId);
    const before = paths.size;
    diff(raw.payload, JSON.parse(JSON.stringify(data)), '$', paths);
    if (paths.size === before && JSON.stringify(raw.payload) === JSON.stringify(data)) identical += 1;
  }
  console.log(`So ${raws.length} sản phẩm · giống hệt: ${identical}`);
  console.table([...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([path, n]) => ({ path, products: n })));
  console.table(samples);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
