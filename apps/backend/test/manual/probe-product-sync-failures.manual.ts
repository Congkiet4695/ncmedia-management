/* eslint-disable */
/**
 * Chẩn đoán CHỈ ĐỌC một lượt đồng bộ sản phẩm PARTIAL: dựng lại đúng danh sách sản phẩm mà lượt
 * INCREMENTAL đã thấy (cùng bộ lọc trạng thái + cùng watermark), gọi Get Product cho từng sản phẩm,
 * rồi đối chiếu với database để chỉ ra sản phẩm nào KHÔNG được ghi và đặc điểm của nó.
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/probe-product-sync-failures.manual.ts <shopId> [<runStartIso>]
 *
 * 🔴 KHÔNG ghi database, KHÔNG refresh token (token sắp hết hạn ⇒ dừng), KHÔNG dựng AppModule (không
 * kéo theo cron). Chỉ gọi Search Products + Get Product (đọc). Không in access token / shop cipher.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import configuration from '../../src/config/configuration';
import { TikTokSdkService } from '../../src/modules/tiktok-sdk/tiktok-sdk.service';
import { TiktokProductApiService } from '../../src/modules/tiktok-sdk/tiktok-product-api.service';
import { TiktokEncryptionService } from '../../src/modules/pod-tiktok/services/tiktok-encryption.service';
import { PodProductMapper } from '../../src/modules/pod-product/mappers/pod-product.mapper';
import {
  POD_PRODUCT_SYNC_OVERLAP_SECONDS,
  POD_PRODUCT_SYNC_TIKTOK_STATUSES,
} from '../../src/modules/pod-product/constants/pod-product.constants';

async function main() {
  const [shopId, runStartIso] = process.argv.slice(2);
  if (!shopId) throw new Error('Thiếu shopId');
  const prisma = new PrismaClient();
  const config = new ConfigService(configuration());

  const shop = await prisma.podTiktokShop.findUniqueOrThrow({ where: { id: shopId }, include: { account: true } });
  if (shop.account.accessTokenExpiresAt.getTime() < Date.now() + 15 * 60_000) {
    throw new Error('Access token sắp hết hạn — dừng để không phải refresh từ máy này');
  }

  const sdk = new TikTokSdkService(config);
  sdk.onModuleInit();
  const api = new TiktokProductApiService(sdk, config);
  const enc = new TiktokEncryptionService(config);
  const mapper = new PodProductMapper();
  const ctx = {
    accessToken: enc.decrypt(shop.account.accessTokenEnc),
    shopCipher: enc.decrypt(shop.shopCipherEnc),
    shopId: shop.id,
    organizationId: shop.organizationId,
  };

  const cursor = shop.productSyncCursor;
  const ids = new Set<string>();
  for (const status of POD_PRODUCT_SYNC_TIKTOK_STATUSES) {
    const list = await api.searchAllProducts(
      ctx,
      { status, ...(cursor === null ? {} : { updateTimeGe: Number(cursor) - POD_PRODUCT_SYNC_OVERLAP_SECONDS }) },
      async () => undefined,
    );
    list.forEach((s) => s.id && ids.add(s.id));
  }
  console.log(`Shop ${shop.name} · cursor=${cursor} · TikTok trả ${ids.size} sản phẩm trong cửa sổ incremental`);

  const runStart = runStartIso ? new Date(runStartIso) : null;
  const rows: any[] = [];
  for (const id of ids) {
    const local = await prisma.podProduct.findFirst({
      where: { shopId, tiktokProductId: id },
      select: { id: true, updatedAt: true, lastSyncedAt: true, payloadHash: true },
    });
    const row: any = { tiktokProductId: id, localUpdatedAt: local?.updatedAt?.toISOString() ?? null };
    try {
      const t = Date.now();
      const { data, requestId } = await api.getProduct(ctx, id);
      row.getMs = Date.now() - t;
      row.requestId = requestId;
      const mapped = mapper.toWriteData(data, data);
      row.status = data.status;
      row.skus = mapped.variants.length;
      row.images = mapped.images.length;
      row.attributes = mapped.attributes.length;
      row.hashSame = local?.payloadHash === mapped.product.payloadHash;
      // Số câu lệnh tuần tự trong transaction của upsertAggregate (đếm theo code hiện tại).
      row.txStatements = 2 + 3 + 1 + mapped.variants.length + 1 + 3 + 2;
    } catch (e: any) {
      row.error = `${e.tiktokCode ?? e.errorClass ?? ''} ${e.tiktokMessage ?? e.message}`;
      row.requestId = e.requestId;
    }
    row.writtenInRun = runStart && local ? local.updatedAt >= runStart : null;
    rows.push(row);
  }
  rows.sort((a, b) => (b.skus ?? 0) - (a.skus ?? 0));
  console.table(rows);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
