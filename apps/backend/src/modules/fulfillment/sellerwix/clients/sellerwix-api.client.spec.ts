import { ConfigService } from '@nestjs/config';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import type { SellerwixCallContext } from '../services/sellerwix-credential.service';
import { SellerwixApiClient } from './sellerwix-api.client';

/**
 * **Cửa ra Sellerwix Public API.**
 *
 * Khoá lại hợp đồng xác thực CHỈ bằng API Key (header `X-Api-Key` — auth cấp collection của
 * Postman "Sellerwix API") cho MỌI thao tác, và luật thử lại: GET thử lại lỗi tạm thời, POST tạo
 * đơn KHÔNG BAO GIỜ tự thử lại.
 */

const CTX: SellerwixCallContext = {
  accountId: 'acc-swx',
  accountName: 'Sellerwix',
  apiKey: 'API-KEY-XYZ',
  storeId: 'store-1',
  baseUrl: 'https://api.sellerwix.test/public-api',
};

type FetchCall = { url: string; init: RequestInit };

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function setup(responder: (call: FetchCall, index: number) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = jest.fn((url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(responder(call, calls.length - 1));
  });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;

  const client = new SellerwixApiClient({
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService);
  // Không ngủ thật trong test (điều tiết tần suất + backoff).
  jest.spyOn(client as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
  return { client, calls, fetchMock };
}

const headersOf = (call: FetchCall) => call.init.headers as Record<string, string>;
const ORDER = {
  store_id: 'store-1',
  line_items: [],
  address: { name: 'a', address1: 'b', city: 'c', zip: 'd', country: 'US' },
};

describe('SellerwixApiClient — xác thực CHỈ bằng API Key', () => {
  it.each([
    ['Get Catalog / Category', (c: SellerwixApiClient) => c.listCategories(CTX), '/v1/category'],
    ['Get Products', (c: SellerwixApiClient) => c.listCategoryProducts(CTX, 7), '/v1/category/7/product'],
    ['Get Variants', (c: SellerwixApiClient) => c.listVariants(CTX, 'SW-MD'), '/v1/product/SW-MD?limit=100'],
    ['Create Order', (c: SellerwixApiClient) => c.createOrder(CTX, ORDER), '/v1/order'],
  ])('%s: đúng MỘT request, header X-Api-Key = API Key, không đổi token / không JWT', async (_name, run, path) => {
    const { client, calls } = setup(() => response(200, {}));

    await run(client);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.sellerwix.test/public-api${path}`);
    expect(headersOf(calls[0])['X-Api-Key']).toBe('API-KEY-XYZ');
    expect(headersOf(calls[0]).authorization).toBeUndefined();
    expect(calls.some((call) => call.url.includes('oauth2'))).toBe(false);
  });

  it('API Key sai (401) ⇒ lỗi AUTH, KHÔNG thử lại', async () => {
    const { client, calls } = setup(() => response(401, { code: 401, message: 'invalid api key' }));

    const error = await client.listCategories(CTX).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentClientError);
    expect((error as FulfillmentClientError).errorClass).toBe(FulfillmentErrorClass.AUTH);
    expect((error as FulfillmentClientError).message).toBe('invalid api key');
    expect(calls).toHaveLength(1);
  });
});

describe('SellerwixApiClient — thử lại & phân loại lỗi', () => {
  it('GET gặp 500 ⇒ thử lại (tối đa 3 lần)', async () => {
    let attempts = 0;
    const { client } = setup(() => {
      attempts += 1;
      return attempts < 3
        ? response(500, { code: 500, message: 'Internal Server Error' })
        : response(200, []);
    });

    await client.listCategories(CTX);
    expect(attempts).toBe(3);
  });

  it('🔴 POST tạo đơn gặp 500 ⇒ KHÔNG tự thử lại (có thể đã tạo ở Sellerwix)', async () => {
    const { client, calls } = setup(() => response(500, { code: 500, message: 'Internal Server Error' }));

    const error = await client.createOrder(CTX, ORDER).catch((caught: unknown) => caught);

    expect(calls).toHaveLength(1);
    expect((error as FulfillmentClientError).errorClass).toBe(FulfillmentErrorClass.SERVER);
    expect((error as FulfillmentClientError).retryable).toBe(true);
  });

  it('timeout / lỗi mạng ⇒ NETWORK (thử lại được), mang mã tương quan', async () => {
    const { client, fetchMock } = setup(() => response(200, {}));
    fetchMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );

    const error = (await client
      .createOrder(CTX, ORDER)
      .catch((caught: unknown) => caught)) as FulfillmentClientError;

    expect(error.errorClass).toBe(FulfillmentErrorClass.NETWORK);
    expect(error.retryable).toBe(true);
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    [400, { code: 400, message: 'bad request' }, FulfillmentErrorClass.VALIDATION, '400'],
    [404, { code: 404, message: 'order not found' }, FulfillmentErrorClass.NOT_FOUND, '404'],
    [429, 'Too Many Requests', FulfillmentErrorClass.RATE_LIMIT, 'HTTP_429'],
    [
      400,
      { error: 'BAD_REQUEST', message: 'limit must be between 1 and 100' },
      FulfillmentErrorClass.VALIDATION,
      'BAD_REQUEST',
    ],
  ])(
    'HTTP %s ⇒ %s, giữ nguyên thông điệp của Sellerwix',
    async (status, body, errorClass, code) => {
      const { client } = setup(() => response(status, body));

      const error = (await client
        .cancelOrder(CTX, 'swx-1', { reason: 'x' })
        .catch((caught: unknown) => caught)) as FulfillmentClientError;

      expect(error.errorClass).toBe(errorClass);
      expect(error.httpStatus).toBe(status);
      expect(error.providerCode).toBe(code);
      expect(error.message).toBe(typeof body === 'string' ? body : body.message);
    },
  );

  it('tra đơn theo reference_id gửi kèm store_id (changelog 2026-04-07)', async () => {
    const { client, calls } = setup(() => response(200, { id: 'x' }));

    await client.getOrderByReference(CTX, 'store-1', '576000000000000001');

    expect(calls[0].url).toBe(
      'https://api.sellerwix.test/public-api/v1/order/576000000000000001?store_id=store-1',
    );
    expect(calls[0].init.method).toBe('GET');
    expect(headersOf(calls[0])['X-Api-Key']).toBe('API-KEY-XYZ');
  });

  it('biến thể: limit=100 và next_page là cursor', async () => {
    const { client, calls } = setup(() => response(200, { data: [] }));

    await client.listVariants(CTX, 'SW-MD-MPTG', 'cursor-2');

    expect(calls[0].url).toBe(
      'https://api.sellerwix.test/public-api/v1/product/SW-MD-MPTG?limit=100&next_page=cursor-2',
    );
  });
});

/**
 * **Điều tiết tần suất** — đồng hồ giả: `sleep` tiến đồng hồ đúng số ms, ghi lại thời điểm GỬI thật của từng request.
 *
 * 🔴 2026-11-16 (đơn 577683942045225361): đồng bộ danh mục chạy sát trần 100 req/60s ⇒ lời gọi tra đơn trước khi
 * tạo nhận 429 (24/24 lần trong 7 ngày rơi vào cửa sổ đồng bộ danh mục). Danh mục giờ có nhóm giãn riêng.
 */
describe('SellerwixApiClient — điều tiết: đồng bộ danh mục chừa hạn mức cho tạo đơn / tra đơn', () => {
  function timed(config: Record<string, unknown> = {}) {
    let clock = 1_000_000;
    const sentAt: Array<{ url: string; at: number }> = [];
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string) => {
      sentAt.push({ url, at: clock });
      return Promise.resolve(response(200, { data: [] }));
    });
    const client = new SellerwixApiClient({
      get: (key: string, fallback?: unknown) => (key in config ? config[key] : fallback),
    } as unknown as ConfigService);
    jest.spyOn(client as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockImplementation((ms: number) => {
      clock += ms;
      return Promise.resolve();
    });
    const gaps = () => sentAt.slice(1).map((entry, index) => entry.at - sentAt[index].at);
    return { client, sentAt, gaps };
  }
  afterEach(() => jest.restoreAllMocks());

  it('lời gọi danh mục giãn ≥ 1200 ms (mặc định) — không còn chạy sát trần 600 ms', async () => {
    const { client, gaps } = timed();
    for (let index = 0; index < 5; index++) await client.listVariants(CTX, `SKU-${index}`);
    await client.listCategories(CTX);
    await client.listCategoryProducts(CTX, 7);
    expect(gaps().every((gap) => gap >= 1200)).toBe(true);
  });

  it('khoảng giãn danh mục cấu hình được (SELLERWIX_CATALOG_MIN_INTERVAL_MS), nhưng không bao giờ dưới trần toàn API 600 ms', async () => {
    const slow = timed({ 'fulfillment.sellerwix.catalogMinIntervalMs': 3000 });
    for (let index = 0; index < 3; index++) await slow.client.listVariants(CTX, `SKU-${index}`);
    expect(slow.gaps()).toEqual([3000, 3000]);
    jest.restoreAllMocks();

    const tooFast = timed({ 'fulfillment.sellerwix.catalogMinIntervalMs': 100 });
    for (let index = 0; index < 3; index++) await tooFast.client.listVariants(CTX, `SKU-${index}`);
    expect(tooFast.gaps()).toEqual([600, 600]);
  });

  it('tra đơn chống trùng (tạo đơn) chen giữa lúc đồng bộ danh mục ⇒ KHÔNG phải chờ hết hàng đợi danh mục', async () => {
    // Hai luồng chạy SONG SONG ⇒ dùng fake timers thật của Jest (đồng hồ giả cộng dồn của `timed` sai khi ngủ song song).
    jest.useFakeTimers({ now: 1_000_000 });
    const sentAt: Array<{ url: string; at: number }> = [];
    (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string) => {
      sentAt.push({ url, at: Date.now() });
      return Promise.resolve(response(200, { data: [] }));
    });
    const client = new SellerwixApiClient({
      get: (_key: string, fallback?: unknown) => fallback,
    } as unknown as ConfigService);
    const catalog = (async () => {
      for (let index = 0; index < 10; index++) await client.listVariants(CTX, `SKU-${index}`);
    })();
    const lookup = client.getOrderByReference(CTX, 'store-1', '577683942045225361');
    const done = Promise.all([catalog, lookup]);
    await jest.runAllTimersAsync();
    await done;
    jest.useRealTimers();

    const lookupAt = sentAt.find((entry) => entry.url.includes('/v1/order/577683942045225361'))!.at;
    const catalogTimes = sentAt.filter((entry) => entry.url.includes('/v1/product/')).map((entry) => entry.at);
    // Đi trong vòng một khe toàn API (600 ms), không xếp sau 10 lời gọi danh mục (~10.8 s).
    expect(lookupAt - catalogTimes[0]).toBeLessThanOrEqual(600);
    // Và mọi request vẫn tôn trọng trần toàn API: không hai request nào cách nhau < 600 ms.
    const all = sentAt.map((entry) => entry.at).sort((a, b) => a - b);
    expect(all.slice(1).every((at, index) => at - all[index] >= 600)).toBe(true);
  });

  it('tra đơn vẫn giữ trần riêng 15 req/phút (4000 ms) như cũ', async () => {
    const { client, gaps } = timed();
    for (let index = 0; index < 3; index++) await client.getOrderByReference(CTX, 'store-1', `REF-${index}`);
    expect(gaps()).toEqual([4000, 4000]);
  });
});
