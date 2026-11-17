import { ConfigService } from '@nestjs/config';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import { SELLERWIX_CATALOG_BACKOFF } from '../constants/sellerwix.constants';
import type { SellerwixCallContext } from '../services/sellerwix-credential.service';
import { SellerwixApiClient, parseRetryAfterSeconds } from './sellerwix-api.client';

/**
 * **Fulfillment ưu tiên hơn đồng bộ danh mục** + **429 ⇒ danh mục dừng** — đồng hồ giả của Jest (các luồng chạy song
 * song như production: một lượt đồng bộ danh mục + nhiều lượt gửi đơn).
 *
 * 🔴 Production 2026-11-10 → 11-17: 37/37 lần tạo đơn Sellerwix nhận 429 rơi vào cửa sổ đồng bộ danh mục; 23/37 khi
 * một TÀI KHOẢN KHÁC đang đồng bộ. Giãn nhịp danh mục (0,7 req/s) không đủ ⇒ danh mục phải NHƯỜNG và DỪNG khi có 429.
 */

const CTX: SellerwixCallContext = {
  accountId: 'acc-swx',
  accountName: 'Sellerwix',
  apiKey: 'API-KEY-XYZ',
  storeId: 'store-1',
  baseUrl: 'https://api.sellerwix.test/public-api',
};
const ORDER = { store_id: 'store-1', line_items: [], address: { name: 'a', address1: 'b', city: 'c', zip: 'd', country: 'US' } };

type Sent = { url: string; method: string; at: number };

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const isCatalog = (url: string) => url.includes('/v1/product/') || url.includes('/v1/category');

function setup(responder: (sent: Sent, index: number) => Response = () => response(200, { data: { id: 'swx-1' } })) {
  jest.useFakeTimers({ now: 1_000_000 });
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const sent: Sent[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init: RequestInit) => {
    const entry = { url, method: String(init.method), at: Date.now() };
    sent.push(entry);
    return Promise.resolve(responder(entry, sent.length - 1));
  });
  const client = new SellerwixApiClient({ get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService);
  const catalogTimes = () => sent.filter((entry) => isCatalog(entry.url)).map((entry) => entry.at);
  return { client, sent, catalogTimes };
}

/** Chạy tới khi mọi promise xong (đồng hồ giả tự tiến qua mọi khoảng chờ). */
async function drain<T>(work: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = work.finally(() => {
    settled = true;
  });
  while (!settled) await jest.advanceTimersByTimeAsync(250);
  return tracked;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SellerwixApiClient — danh mục NHƯỜNG Fulfillment', () => {
  it('đang có lượt gửi đơn ⇒ danh mục đứng chờ tới hết lượt + grace; lượt gửi KHÔNG bị chậm vì danh mục', async () => {
    const { client, sent, catalogTimes } = setup();
    let leaseEnd = 0;
    const fulfill = client.withPriority('fulfill', async () => {
      await client.getOrderByReference(CTX, 'store-1', 'REF-1');
      await wait(10_000); // các bước nội bộ của lượt gửi (DB, kiểm payload…)
      await client.createOrder(CTX, ORDER);
      leaseEnd = Date.now();
    });
    const catalog = (async () => {
      for (let index = 0; index < 3; index++) await client.listVariants(CTX, `SKU-${index}`);
    })();

    await drain(Promise.all([fulfill, catalog]));

    const create = sent.find((entry) => entry.method === 'POST')!;
    // Tạo đơn đi ngay sau 10 s nội bộ — không xếp sau lời gọi danh mục nào.
    expect(create.at - 1_000_000).toBeLessThan(10_000 + 1_000);
    expect(catalogTimes()).toHaveLength(3);
    expect(catalogTimes().every((at) => at >= leaseEnd + SELLERWIX_CATALOG_BACKOFF.priorityGraceMs)).toBe(true);
  });

  it('🔴 đồng thời: danh mục 20 lời gọi + 3 lượt gửi đơn ⇒ không deadlock, không đói, đúng 3 lần tạo đơn, danh mục không chen vào lượt gửi', async () => {
    const { client, sent, catalogTimes } = setup();
    const leases: Array<{ start: number; end: number }> = [];
    const order = (delayMs: number, ref: string) =>
      (async () => {
        await wait(delayMs);
        const start = Date.now();
        await client.withPriority('fulfill', async () => {
          await client.getOrderByReference(CTX, 'store-1', ref);
          await client.createOrder(CTX, { ...ORDER, reference_id: ref });
        });
        leases.push({ start, end: Date.now() });
      })();
    const catalog = (async () => {
      for (let index = 0; index < 20; index++) await client.listVariants(CTX, `SKU-${index}`);
    })();

    await drain(Promise.all([catalog, order(2_000, 'A'), order(2_500, 'B'), order(9_000, 'C')]));

    expect(sent.filter((entry) => entry.method === 'POST')).toHaveLength(3);
    expect(catalogTimes()).toHaveLength(20);
    // Không lời gọi danh mục nào được GỬI khi một lượt gửi đơn đang chạy.
    for (const at of catalogTimes()) {
      expect(leases.some((lease) => at > lease.start && at < lease.end)).toBe(false);
    }
    // Mọi request vẫn tôn trọng nhịp toàn API (600 ms).
    const all = sent.map((entry) => entry.at).sort((a, b) => a - b);
    expect(all.slice(1).every((at, index) => at - all[index] >= 600)).toBe(true);
  });
});

describe('SellerwixApiClient — 429 ⇒ danh mục DỪNG (lùi cấp số nhân + nhiễu), không retry storm', () => {
  it('danh mục gặp 429 ⇒ lần thử kế tiếp chờ ≥ 30 s rồi ≥ 60 s (không phải 1–2 s); số lần thử KHÔNG tăng (3)', async () => {
    const { client, catalogTimes } = setup((sent, index) =>
      isCatalog(sent.url) && index < 2 ? response(429, { code: 429, message: 'Too many requests' }) : response(200, { data: { data: [] } }),
    );

    await drain(client.listVariants(CTX, 'SKU-1'));

    const [first, second, third] = catalogTimes();
    expect(catalogTimes()).toHaveLength(3);
    expect(second - first).toBeGreaterThanOrEqual(SELLERWIX_CATALOG_BACKOFF.baseMs);
    expect(third - second).toBeGreaterThanOrEqual(SELLERWIX_CATALOG_BACKOFF.baseMs * 2);
  });

  it('429 cả 3 lần ⇒ lỗi RATE_LIMIT sau ĐÚNG 3 lần gọi (không ép thêm)', async () => {
    const { client, catalogTimes } = setup(() => response(429, { code: 429, message: 'Too many requests' }));
    const error = await drain(client.listVariants(CTX, 'SKU-1').catch((caught: unknown) => caught));
    expect(error).toBeInstanceOf(FulfillmentClientError);
    expect((error as FulfillmentClientError).errorClass).toBe(FulfillmentErrorClass.RATE_LIMIT);
    expect(catalogTimes()).toHaveLength(3);
  });

  it('Fulfillment gặp 429 ⇒ Fulfillment giữ chính sách thử lại cũ (vài giây), còn danh mục dừng ≥ 30 s', async () => {
    const { client, sent, catalogTimes } = setup((entry, index) =>
      index === 0 ? response(429, { code: 429, message: 'Too many requests' }) : response(200, { data: { id: 'swx-1', data: [] } }),
    );

    await drain(client.getOrderByReference(CTX, 'store-1', 'REF-1'));
    const lookups = sent.filter((entry) => entry.url.includes('/v1/order/'));
    expect(lookups).toHaveLength(2);
    // Thử lại của Fulfillment KHÔNG bị kéo theo khoảng dừng của danh mục (chỉ nhịp tra đơn 4 s + backoff 1 s).
    expect(lookups[1].at - lookups[0].at).toBeLessThan(10_000);

    await drain(client.listVariants(CTX, 'SKU-1'));
    expect(catalogTimes()[0] - lookups[0].at).toBeGreaterThanOrEqual(SELLERWIX_CATALOG_BACKOFF.baseMs);
  });

  it('Sellerwix gửi Retry-After ⇒ dừng đúng khoảng đó', async () => {
    const { client, catalogTimes } = setup((sent, index) =>
      index === 0 ? response(429, { code: 429 }, { 'retry-after': '120' }) : response(200, { data: { data: [] } }),
    );
    await drain(client.listVariants(CTX, 'SKU-1'));
    const [first, second] = catalogTimes();
    expect(second - first).toBeGreaterThanOrEqual(120_000);
  });

  it('lời gọi danh mục thành công ⇒ đặt lại bậc lùi (429 kế tiếp lại chỉ dừng 30 s, không 60 s)', async () => {
    const { client, catalogTimes } = setup((sent, index) =>
      index === 0 || index === 2 ? response(429, { code: 429 }) : response(200, { data: { data: [] } }),
    );
    await drain(client.listVariants(CTX, 'SKU-1'));
    await drain(client.listVariants(CTX, 'SKU-2'));
    const times = catalogTimes();
    expect(times).toHaveLength(4);
    expect(times[3] - times[2]).toBeGreaterThanOrEqual(SELLERWIX_CATALOG_BACKOFF.baseMs);
    expect(times[3] - times[2]).toBeLessThan(SELLERWIX_CATALOG_BACKOFF.baseMs * 2);
  });

  it('danh mục chạy tiếp sau khoảng dừng (không kẹt vĩnh viễn)', async () => {
    const { client, catalogTimes } = setup((sent, index) =>
      index === 0 ? response(429, { code: 429 }) : response(200, { data: { data: [] } }),
    );
    await drain(
      (async () => {
        for (let index = 0; index < 5; index++) await client.listVariants(CTX, `SKU-${index}`);
      })(),
    );
    expect(catalogTimes()).toHaveLength(6);
  });
});

describe('parseRetryAfterSeconds', () => {
  it('số giây / HTTP-date / sai dạng', () => {
    const now = Date.parse('2026-11-17T00:00:00Z');
    expect(parseRetryAfterSeconds('120', now)).toBe(120);
    expect(parseRetryAfterSeconds('Tue, 17 Nov 2026 00:01:30 GMT', now)).toBe(90);
    expect(parseRetryAfterSeconds('soon', now)).toBeUndefined();
    expect(parseRetryAfterSeconds(null, now)).toBeUndefined();
    expect(parseRetryAfterSeconds('  ', now)).toBeUndefined();
  });
});
