/* eslint-disable */
/**
 * Thăm dò API **Get Brands** THẬT của TikTok — kiểm chứng ba giả định mà
 * `TiktokBrandCrawlerService` dựa vào (xem `tiktok-brand-crawl.constants.ts`).
 *
 * Chạy:  node -r ts-node/register -r dotenv/config test/manual/probe-tiktok-brands-api.manual.ts
 * Cần: database local có ít nhất một shop TikTok đủ điều kiện làm nguồn. KHÔNG ghi database.
 * Tốn ~150 lời gọi TikTok.
 *
 * Kết quả đo ngày 2026-09-18 (BRAND_SYNC_FIX_REPORT.md):
 *   1. Không lọc: total_count = 10000 (bị kẹp); trang 101 ⇒ lỗi 12019123.
 *   2. brand_name là bộ lọc "bắt đầu bằng", không phân biệt hoa/thường, nhận Unicode.
 *   3. Trang 1 của cùng một truy vấn trả về HAI thứ tự khác nhau (~2:1); một lượt đi hết
 *      trang của "MAG" (3.097) chỉ thu 2.534–2.701 bản ghi duy nhất; gộp 3 lượt mới đủ.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { TiktokProductApiService } from '../../src/modules/tiktok-sdk/tiktok-product-api.service';
import { TIKTOK_BRAND_PREFIX_BASE_ALPHABET } from '../../src/modules/tiktok-sdk/tiktok-brand-crawl.constants';
import { PodProductCatalogService } from '../../src/modules/pod-product/services/pod-product-catalog.service';
import { PodProductSyncRepository } from '../../src/modules/pod-product/repositories/pod-product-sync.repository';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const decode = (t?: string) => (t ? Buffer.from(t, 'base64').toString() : 'null');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const api = app.get(TiktokProductApiService);
  const target = (await app.get(PodProductSyncRepository).findSyncTargets({}))[0];
  if (!target) throw new Error('Không có shop TikTok nào làm nguồn được');
  const ctx = await app.get(PodProductCatalogService).buildContext(target);

  const probe = async (label: string, params: Parameters<TiktokProductApiService['getBrands']>[1]) => {
    try {
      const { data } = await api.getBrands(ctx, params);
      console.log(
        `${label}: items=${data.items.length} total=${data.totalCount} next=${decode(data.nextPageToken)} ` +
          `first=${JSON.stringify(data.items[0]?.name ?? null)} last=${JSON.stringify(data.items.at(-1)?.name ?? null)}`,
      );
      return data;
    } catch (e: any) {
      console.log(`${label}: ERROR ${e.tiktokCode ?? ''} ${e.message}`);
      return null;
    }
  };

  console.log('\n▶ 1. Cửa sổ 10.000 (không lọc)');
  await probe('page 1', {});
  await probe('page 100', { pageToken: b64('page_number=100') });
  await probe('page 101 (mong đợi lỗi 12019123)', { pageToken: b64('page_number=101') });

  console.log('\n▶ 2. brand_name = prefix, không phân biệt hoa/thường, Unicode');
  for (const brandName of ['A', 'a', 'Nike', 'ike', 'MA', 'THE', 'é', 'เ', '中', 'Ａ']) {
    await probe(`prefix ${JSON.stringify(brandName)}`, { brandName });
  }

  console.log('\n▶ 3. Thứ tự trang không ổn định');
  const orderings = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const data = await probe(`A page 1 #${i + 1}`, { brandName: 'A' });
    const key = (data?.items ?? []).slice(0, 3).map((b) => b.name).join(' | ');
    orderings.set(key, (orderings.get(key) ?? 0) + 1);
  }
  console.log('Số thứ tự khác nhau của cùng một trang:', [...orderings.entries()]);

  const walk = async (brandName: string) => {
    const ids = new Set<string>();
    let token: string | undefined;
    let total = 0;
    do {
      const { data } = await api.getBrands(ctx, { brandName, pageToken: token });
      total = data.totalCount ?? 0;
      data.items.forEach((b) => b.id && ids.add(b.id));
      token = data.nextPageToken;
    } while (token);
    return { ids, total };
  };
  const w1 = await walk('MAG');
  const w2 = await walk('MAG');
  const union = new Set([...w1.ids, ...w2.ids]);
  console.log(`MAG: total=${w1.total} walk1=${w1.ids.size} walk2=${w2.ids.size} union=${union.size}`);

  console.log('\n▶ 4. Dấu câu ASCII đi qua chữ ký SDK');
  for (const ch of TIKTOK_BRAND_PREFIX_BASE_ALPHABET) {
    if (/[a-z0-9]/.test(ch)) continue;
    await probe(`prefix ${JSON.stringify(ch)}`, { brandName: ch });
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
