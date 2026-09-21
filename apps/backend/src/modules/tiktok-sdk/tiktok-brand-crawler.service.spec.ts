import { TIKTOK_BRAND_WINDOW_LIMIT } from './tiktok-brand-crawl.constants';
import {
  TiktokBrandCrawlerService,
  type TiktokBrandCrawlProgress,
} from './tiktok-brand-crawler.service';
import type { TiktokBrand } from './types/tiktok-product.types';

/**
 * Unit test — TiktokBrandCrawlerService.
 *
 * 🔴 Bộ test này mô phỏng ĐÚNG ba giới hạn đo được trên API Get Brands thật (2026-09-18):
 *
 *   1. Cửa sổ 10.000 bản ghi / truy vấn: `total_count` bị kẹp, trang 101 bị từ chối.
 *   2. `brand_name` là bộ lọc prefix, không phân biệt hoa/thường.
 *   3. Thứ tự trang đổi giữa các lần gọi (hai bản sao sắp xếp theo hai khoá khác nhau).
 *
 * Mỗi test dưới đây là một cách mà "gọi rồi đi hết page_token" từng để lọt dữ liệu.
 */

const PAGE_SIZE = 100;
const CTX = { accessToken: 't', shopCipher: 'c', shopId: 'shop-1' } as never;

interface FakeOptions {
  /** Đổi thứ tự sắp xếp theo từng lời gọi (mô phỏng hai bản sao phía TikTok). */
  unstable?: boolean;
  /** Prefix (đã hạ chữ thường) mà API sẽ ném lỗi — luôn, hoặc chỉ N lần đầu (`failTimes`). */
  failPrefixes?: Set<string>;
  failTimes?: number;
  /** Ném lỗi cho MỌI prefix khác rỗng — mô phỏng token chết giữa chừng. */
  failAllChildren?: boolean;
  /** Brand chỉ "hiện" khi prefix dài ≥ n ký tự — mô phỏng bản ghi kẹt ở ranh giới trang. */
  hiddenUntilPrefixLength?: { id: string; length: number };
  /** Trả cùng một brand hai lần trong một trang. */
  duplicateInPage?: boolean;
}

const encodeToken = (page: number) => Buffer.from(`page_number=${page}`).toString('base64');
const decodeToken = (token: string) =>
  Number(Buffer.from(token, 'base64').toString().split('=')[1]);

/** Get Brands giả — bám sát hành vi thật: cửa sổ 10.000, lọc prefix, thứ tự có thể đổi. */
class FakeBrandApi {
  calls = 0;
  readonly prefixesSeen = new Set<string>();
  readonly failures = new Map<string, number>();

  constructor(
    private readonly brands: Array<{ id: string; name: string }>,
    private readonly options: FakeOptions = {},
  ) {}

  getBrands(
    _ctx: unknown,
    params: { brandName?: string; pageToken?: string },
  ): Promise<{ data: { items: TiktokBrand[]; nextPageToken?: string; totalCount?: number } }> {
    this.calls += 1;
    const prefix = (params.brandName ?? '').toLowerCase();
    this.prefixesSeen.add(prefix);

    if (this.options.failPrefixes?.has(prefix)) {
      const count = (this.failures.get(prefix) ?? 0) + 1;
      this.failures.set(prefix, count);
      if (this.options.failTimes === undefined || count <= this.options.failTimes) {
        return Promise.reject(new Error(`TikTok 500 for prefix "${prefix}"`));
      }
    }
    if (this.options.failAllChildren && prefix !== '') {
      return Promise.reject(new Error('TikTok 401 token expired'));
    }

    const page = params.pageToken ? decodeToken(params.pageToken) : 1;
    if (page * PAGE_SIZE > TIKTOK_BRAND_WINDOW_LIMIT) {
      return Promise.reject(
        new Error('12019123 product of pageSize and pageNumber exceeds the maximum limit'),
      );
    }

    const hidden = this.options.hiddenUntilPrefixLength;
    let matched = this.brands.filter((brand) => brand.name.toLowerCase().startsWith(prefix));
    const totalCount = Math.min(matched.length, TIKTOK_BRAND_WINDOW_LIMIT);
    if (hidden && prefix.length < hidden.length) {
      matched = matched.filter((brand) => brand.id !== hidden.id);
    }

    // Bản sao A sắp theo tên; bản sao B lệch nửa trang (mỗi trang của B vắt qua hai trang của A)
    // — mỗi lời gọi rơi vào một bản sao, nên một lượt đi hết trang chắc chắn bỏ sót, y như đo
    // được trên API thật.
    let ordered = [...matched].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    if (this.options.unstable && this.calls % 2 === 0) {
      const shift = PAGE_SIZE / 2;
      ordered = [...ordered.slice(shift), ...ordered.slice(0, shift)];
    }

    const items = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (this.options.duplicateInPage && items.length > 1) items.push(items[0]);

    const hasNext = page * PAGE_SIZE < totalCount;
    return Promise.resolve({
      data: { items, totalCount, nextPageToken: hasNext ? encodeToken(page + 1) : undefined },
    });
  }
}

/** Sinh N thương hiệu tên ASCII trải đều theo bảng chữ cái (đủ để vượt cửa sổ 10.000). */
function generateBrands(count: number, prefix = ''): Array<{ id: string; name: string }> {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: count }, (_, index) => {
    const a = letters[index % 26];
    const b = letters[Math.floor(index / 26) % 26];
    const c = letters[Math.floor(index / 676) % 26];
    return { id: `id-${prefix}${index}`, name: `${prefix}${a}${b}${c} brand ${index}` };
  });
}

async function crawlAll(api: FakeBrandApi, onProgress?: (p: TiktokBrandCrawlProgress) => void) {
  const service = new TiktokBrandCrawlerService(api as never);
  const emitted = new Map<string, TiktokBrand>();
  const batches: number[] = [];

  const report = await service.crawl(CTX, {
    onBatch: (brands) => {
      batches.push(brands.length);
      brands.forEach((brand) => emitted.set(brand.id!, brand));
      return Promise.resolve();
    },
    onProgress,
  });

  return { report, emitted, batches };
}

describe('TiktokBrandCrawlerService', () => {
  it('nhiều trang, has_more rồi hết ⇒ lấy đủ, mỗi trang một lời gọi', async () => {
    const api = new FakeBrandApi(generateBrands(250));

    const { report, emitted } = await crawlAll(api);

    expect(emitted.size).toBe(250);
    expect(report.apiCalls).toBe(3);
    expect(report.cappedPrefixes).toBe(0);
    expect(report.incomplete).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it('không có thương hiệu nào ⇒ một lời gọi, không ghi gì, không lỗi', async () => {
    const api = new FakeBrandApi([]);

    const { report, emitted, batches } = await crawlAll(api);

    expect(emitted.size).toBe(0);
    expect(batches).toEqual([]);
    expect(report.apiCalls).toBe(1);
  });

  it('🔴 vượt cửa sổ 10.000 ⇒ chia theo prefix và lấy ĐỦ, không bao giờ xin trang 101', async () => {
    const brands = generateBrands(12_000);
    const api = new FakeBrandApi(brands);

    const { report, emitted } = await crawlAll(api);

    expect(emitted.size).toBe(12_000);
    expect(report.cappedPrefixes).toBeGreaterThanOrEqual(1);
    expect(report.incomplete).toEqual([]);
    expect(report.failed).toEqual([]);
    // Mọi id đều có mặt — không chỉ "hơn 10.000".
    for (const brand of brands) expect(emitted.has(brand.id)).toBe(true);
  });

  it('🔴 thứ tự trang đổi giữa các lời gọi ⇒ đi lại và gộp cho tới khi khớp total_count', async () => {
    const brands = generateBrands(2_500, 'nike ');
    const api = new FakeBrandApi(brands, { unstable: true });

    const { report, emitted } = await crawlAll(api);

    expect(emitted.size).toBe(2_500);
    expect(report.incomplete).toEqual([]);
    // Một lượt là 25 trang; phải có nhiều hơn thế vì lượt đầu chắc chắn thiếu.
    expect(report.apiCalls).toBeGreaterThan(25);
  });

  it('🔴 đi đủ số lượt vẫn thiếu ⇒ chia tiếp theo ký tự kế tiếp thay vì bỏ cuộc', async () => {
    const brands = generateBrands(300);
    // "qba brand 42" chỉ lộ ra khi prefix dài ≥ 2 — không lượt đi lại nào ở gốc hay ở "q" vớt
    // được nó; chỉ prefix "qb" (suy ra từ "qbz visible", một tên khác cùng hai ký tự đầu) mới tới.
    const hidden = brands[42];
    brands.push({ id: 'sibling', name: 'qbz visible' });
    const api = new FakeBrandApi(brands, {
      hiddenUntilPrefixLength: { id: hidden.id, length: 2 },
    });

    const { report, emitted } = await crawlAll(api);

    expect(emitted.has(hidden.id)).toBe(true);
    expect(emitted.size).toBe(301);
    expect(report.refinedPrefixes).toBeGreaterThanOrEqual(1);
    expect(report.incomplete).toEqual([]);
    expect(api.prefixesSeen.has('qb')).toBe(true);
  });

  it('không còn ký tự nào để chia mà vẫn thiếu ⇒ ghi nhận `incomplete` thật thà, không lặp vô hạn', async () => {
    // Ba brand cùng tên "x" (không có ký tự kế tiếp) và một trong số đó không bao giờ lộ ra:
    // gốc chia xuống "x", "x" hết đường chia ⇒ báo thiếu đúng con số.
    const brands = [
      { id: '1', name: 'x' },
      { id: '2', name: 'x' },
      { id: '3', name: 'x' },
    ];
    const api = new FakeBrandApi(brands, { hiddenUntilPrefixLength: { id: '3', length: 5 } });

    const { report, emitted } = await crawlAll(api);

    expect(emitted.size).toBe(2);
    expect(report.incomplete).toEqual([{ prefix: 'x', total: 3, unique: 2 }]);
    expect(report.apiCalls).toBeLessThan(40);
  });

  it('cùng một brand lặp trong trang ⇒ chỉ giao một lần theo id', async () => {
    const api = new FakeBrandApi(generateBrands(150), { duplicateInPage: true });

    const { report, emitted } = await crawlAll(api);

    expect(emitted.size).toBe(150);
    expect(report.emitted).toBe(150);
    expect(report.fetched).toBeGreaterThan(150);
  });

  it('bản ghi không có id bị bỏ qua và được đếm riêng', async () => {
    const api = new FakeBrandApi([
      { id: '1', name: 'Nike' },
      { id: '', name: 'Không id' },
    ]);

    const { report, emitted } = await crawlAll(api);

    expect(emitted.size).toBe(1);
    expect(report.skippedWithoutId).toBe(1);
    // Bản ghi không id nằm trong total_count ⇒ KHÔNG được coi là "thiếu" rồi đi lại vô ích.
    expect(report.apiCalls).toBe(1);
    expect(report.refinedPrefixes).toBe(0);
  });

  it('🔴 một prefix hỏng CẢ khi thử lại ⇒ ghi vào `failed`, các prefix khác vẫn được lấy, không ném lỗi', async () => {
    const brands = generateBrands(12_000);
    const api = new FakeBrandApi(brands, { failPrefixes: new Set(['b']) });

    const { report, emitted } = await crawlAll(api);

    expect(report.failed).toEqual([{ prefix: 'b', error: 'TikTok 500 for prefix "b"' }]);
    expect(report.recovered).toBe(0);
    // Thử lại đúng MỘT lần rồi thôi — không lặp vô hạn trên một prefix hỏng thật.
    expect(api.failures.get('b')).toBe(2);
    // Mọi brand KHÔNG bắt đầu bằng "b" đều có mặt.
    const expected = brands.filter((brand) => !brand.name.startsWith('b'));
    for (const brand of expected) expect(emitted.has(brand.id)).toBe(true);
    expect(report.incomplete).toEqual([]);
  });

  it('🔴 prefix hỏng vì lỗi TẠM THỜI ⇒ được thử lại cuối lượt và lấy đủ, không còn trong `failed`', async () => {
    const brands = generateBrands(12_000);
    const api = new FakeBrandApi(brands, { failPrefixes: new Set(['b']), failTimes: 1 });

    const { report, emitted } = await crawlAll(api);

    expect(report.failed).toEqual([]);
    expect(report.recovered).toBe(1);
    expect(emitted.size).toBe(12_000);
  });

  it('🔴 chữ Latin có dấu ở ký tự THỨ HAI dưới prefix chạm trần ("cá", "cơ") vẫn được tìm thấy', async () => {
    const brands = [
      ...generateBrands(10_050), // gốc chạm trần; "c…" cũng đủ nhiều để coi như ẩn sau cửa sổ ASCII
      { id: 'ca-map', name: 'Cá Mập Gold X2' },
      { id: 'com-chay', name: 'Cơm cháy Ninh Bình' },
      { id: 'de-vang', name: 'DÊ VÀNG 8888' },
    ];
    const api = new FakeBrandApi(brands);

    const { emitted } = await crawlAll(api);

    expect(emitted.has('ca-map')).toBe(true);
    expect(emitted.has('com-chay')).toBe(true);
    expect(emitted.has('de-vang')).toBe(true);
  });

  it('ký tự mà TikTok gập về ASCII ("İ" ≡ "i") không tạo prefix trùng', async () => {
    const api = new FakeBrandApi([...generateBrands(10_050), { id: 'ist', name: 'İstanbul Wear' }]);

    const { emitted } = await crawlAll(api);

    expect(emitted.has('ist')).toBe(true);
    expect(api.prefixesSeen.has('İ')).toBe(false);
  });

  it('🔴 tên ở dạng Unicode tổ hợp ("ba" + U+0301) dưới prefix chạm trần vẫn được tìm thấy', async () => {
    // 10.050 tên "ba…" ⇒ gốc, "b" và "ba" đều chạm trần; tên dạng tổ hợp chỉ tới được qua "ba"+U+0301.
    const brands = [
      ...generateBrands(10_050, 'ba'),
      { id: 'nfd', name: 'Bánh Kẹo Bảo Minh' },
    ];
    const api = new FakeBrandApi(brands);

    const { emitted } = await crawlAll(api);

    expect(emitted.has('nfd')).toBe(true);
    expect(api.prefixesSeen.has('bá')).toBe(true);
  });

  it('🔴 ký hiệu ngoài ASCII phát hiện MUỘN (ở prefix khác) vẫn được gieo lại cho prefix chạm trần', async () => {
    // 10.050 tên "d…" ⇒ "d" chạm trần; "D´zzz" sắp sau mọi tên ASCII nên nằm ngoài cửa sổ 10.000
    // của "d". Ký hiệu "´" chỉ được phát hiện khi quét "zz´ Symbol" (prefix "z", xử lý SAU "d").
    const brands = [
      ...generateBrands(10_050, 'd'),
      { id: 'd-acute', name: 'D´zzz' },
      { id: 'z-acute', name: 'zz´ Symbol' },
    ];
    const api = new FakeBrandApi(brands);

    const { emitted } = await crawlAll(api);

    expect(emitted.has('z-acute')).toBe(true);
    expect(emitted.has('d-acute')).toBe(true);
    expect(api.prefixesSeen.has('d´')).toBe(true);
  });

  it('🔴 hỏng liên tiếp quá ngưỡng (token chết) ⇒ huỷ cả lượt kèm số đã ghi, không đốt hàng nghìn call', async () => {
    const api = new FakeBrandApi(generateBrands(12_000), { failAllChildren: true });
    const service = new TiktokBrandCrawlerService(api as never);
    let emitted = 0;

    await expect(
      service.crawl(CTX, {
        onBatch: (brands) => {
          emitted += brands.length;
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow(/hỏng liên tiếp/);

    // Cửa sổ gốc (10.000 bản ghi) đã được giao trước khi huỷ — dữ liệu đã trả tiền không bị bỏ.
    expect(emitted).toBe(TIKTOK_BRAND_WINDOW_LIMIT);
    // 100 trang gốc + tối đa (ngưỡng + số luồng) prefix con hỏng — không phải hàng trăm.
    expect(api.calls).toBeLessThan(100 + 20);
  });

  it('🔴 tên bắt đầu bằng chữ Thái / Hán tự vẫn được tìm thấy (mồi hệ chữ + phát hiện từ tên đã lấy)', async () => {
    const brands = [
      ...generateBrands(10_050), // gốc chạm trần ⇒ phải chia
      { id: 'thai', name: 'เคลียร์' },
      { id: 'cjk', name: '中燕堂' },
      // Hán tự "中" xuất hiện GIỮA một tên Latin ⇒ trở thành prefix gốc để tìm "中燕堂".
      { id: 'mixed', name: 'AB 中文 Shop' },
    ];
    const api = new FakeBrandApi(brands);

    const { emitted } = await crawlAll(api);

    expect(emitted.has('thai')).toBe(true);
    expect(emitted.has('cjk')).toBe(true);
    expect(emitted.has('mixed')).toBe(true);
    expect(api.prefixesSeen.has('เ')).toBe(true);
    expect(api.prefixesSeen.has('中')).toBe(true);
  });

  it('báo tiến độ định kỳ với số lời gọi, số bản ghi và prefix đang xử lý', async () => {
    const api = new FakeBrandApi(generateBrands(12_000));
    const snapshots: TiktokBrandCrawlProgress[] = [];

    await crawlAll(api, (progress) => {
      snapshots.push(progress);
    });

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].apiCalls).toBe(100);
    expect(snapshots.at(-1)!.fetched).toBeGreaterThan(0);
    expect(Array.isArray(snapshots[0].activePrefixes)).toBe(true);
  });
});
