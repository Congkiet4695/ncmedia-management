import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import type { PressifyCallContext } from '../services/pressify-credential.service';
import { PRESSIFY_BUSINESS_RULE_CODE, PressifyApiClient } from './pressify-api.client';

/**
 * **PressifyApiClient — hợp đồng HTTP theo tài liệu Pressify.**
 *
 * Kiểm: key ở đúng chỗ (query cho GET, body cho POST) nhưng KHÔNG BAO GIỜ lọt vào log / thông điệp lỗi;
 * phân loại lỗi đúng bảng "Errors and rate limits"; chỉ GET chỉ-đọc được thử lại.
 */

const KEY = 'store-key-SECRET-1234';
const ctx: PressifyCallContext = {
  accountId: 'acc-1',
  accountName: 'Pressify',
  apiKey: KEY,
  baseUrl: null,
};

function response(status: number, body: unknown, contentType = 'application/json'): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function build(responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetchMock = jest.fn((_url: string, _init?: RequestInit) => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const config = {
    get: (key: string, fallback?: unknown) =>
      key === 'fulfillment.pressify.baseUrl'
        ? 'https://pressify.test/api'
        : key === 'fulfillment.pressify.timeoutMs'
          ? 5000
          : fallback,
  } as unknown as ConfigService;
  const client = new PressifyApiClient(config);
  // Không ngủ thật khi điều tiết / thử lại.
  (client as unknown as { sleep: (ms: number) => Promise<void> }).sleep = () => Promise.resolve();
  return { client, fetchMock };
}

describe('PressifyApiClient', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
      });
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('GET có xác thực: key nằm trên query string; log CHỈ có METHOD + path (không key, không query)', async () => {
    const { client, fetchMock } = build([
      response(200, { data: [{ code: 'TKB' }], message: 'success' }),
    ]);

    const result = await client.listAccessories(ctx);

    expect(result.data.data).toEqual([{ code: 'TKB' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://pressify.test/api/product/accessory?api_key=${KEY}`);
    expect((init?.headers as Record<string, string>).accept).toBe('application/json');
    expect(init?.redirect).toBe('manual');
    expect(logs.join('\n')).toContain('GET /product/accessory');
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain('api_key');
  });

  it('GET /all-product KHÔNG gửi key (tài liệu: tra catalog không cần key)', async () => {
    const { client, fetchMock } = build([
      response(200, { data: [], tiers: {} }, 'text/html; charset=UTF-8'),
    ]);

    await client.listAllProducts();

    expect(fetchMock.mock.calls[0][0]).toBe('https://pressify.test/api/all-product');
  });

  it('POST /order: key nằm TRONG body JSON, kèm Content-Type + Accept JSON', async () => {
    const { client, fetchMock } = build([
      response(200, { data: 2885109, price: { total: 12.97 }, msg: '', status: 'success' }),
    ]);

    const result = await client.createOrder(ctx, {
      ref_id: 'TT-1',
      order_status: 'new_order',
      shipping_method: 'standard',
      line_items: [],
    });

    expect(result.data.data).toBe(2885109);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pressify.test/api/order');
    expect(JSON.parse(init?.body as string)).toEqual({
      api_key: KEY,
      ref_id: 'TT-1',
      order_status: 'new_order',
      shipping_method: 'standard',
      line_items: [],
    });
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('JSON trả với content-type text/html vẫn được đọc (đã thấy ở API thật)', async () => {
    const { client } = build([
      response(200, '{"data":[{"variant_id":102}]}', 'text/html; charset=UTF-8'),
    ]);
    const result = await client.listAllProducts();
    expect(result.data).toEqual({ data: [{ variant_id: 102 }] });
  });

  it('404 "invalid seller" (key sai) ⇒ AUTH, không thử lại', async () => {
    const { client, fetchMock } = build([response(404, { data: [], message: 'invalid seller' })]);

    const error = await client.listAccessories(ctx).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentClientError);
    expect((error as FulfillmentClientError).errorClass).toBe(FulfillmentErrorClass.AUTH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('422 ⇒ VALIDATION kèm lỗi theo field (ref id trùng)', async () => {
    const { client } = build([
      response(422, {
        message: 'The ref id has already been taken.',
        errors: { ref_id: ['The ref id has already been taken.'] },
      }),
    ]);

    const error = (await client
      .createOrder(ctx, {
        ref_id: 'TT-1',
        order_status: 'new_order',
        shipping_method: 'standard',
        line_items: [],
      })
      .catch((caught: unknown) => caught)) as FulfillmentClientError;

    expect(error.errorClass).toBe(FulfillmentErrorClass.VALIDATION);
    expect(error.validationErrors).toEqual([
      { field: 'ref_id', message: 'The ref id has already been taken.' },
    ]);
  });

  it('500 + {status:"error", msg} ở POST /order ⇒ ĐƠN BỊ TỪ CHỐI (VALIDATION), KHÔNG thử lại, KHÔNG mập mờ', async () => {
    const { client, fetchMock } = build([
      response(500, { data: '', msg: 'variant_id is invalid', status: 'error' }),
    ]);

    const error = (await client
      .createOrder(ctx, {
        ref_id: 'TT-1',
        order_status: 'new_order',
        shipping_method: 'standard',
        line_items: [],
      })
      .catch((caught: unknown) => caught)) as FulfillmentClientError;

    expect(error.errorClass).toBe(FulfillmentErrorClass.VALIDATION);
    expect(error.providerCode).toBe(PRESSIFY_BUSINESS_RULE_CODE);
    expect(error.message).toBe('variant_id is invalid');
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('500 "Api key is invalid" ở POST /order ⇒ AUTH', async () => {
    const { client } = build([
      response(500, { data: '', msg: 'Api key is invalid', status: 'error' }),
    ]);
    const error = (await client
      .createOrder(ctx, {
        ref_id: 'TT-1',
        order_status: 'new_order',
        shipping_method: 'standard',
        line_items: [],
      })
      .catch((caught: unknown) => caught)) as FulfillmentClientError;
    expect(error.errorClass).toBe(FulfillmentErrorClass.AUTH);
  });

  it('500 không phải quy tắc nghiệp vụ ở GET ⇒ SERVER, được thử lại tối đa 3 lần', async () => {
    const { client, fetchMock } = build([response(500, 'Internal Server Error', 'text/html')]);

    const error = (await client
      .getOrder(ctx, '2885109')
      .catch((caught: unknown) => caught)) as FulfillmentClientError;

    expect(error.errorClass).toBe(FulfillmentErrorClass.SERVER);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429 "Blocked for 5 seconds" ⇒ RATE_LIMIT, chờ đúng số giây Pressify báo rồi thử lại', async () => {
    const { client, fetchMock } = build([
      response(429, {
        data: [],
        msg: 'Too many requests. Blocked for 5 seconds.',
        status: 'error',
      }),
      response(200, { id: 2885109, fulfill_status: 'pending' }),
    ]);
    const sleeps: number[] = [];
    (client as unknown as { sleep: (ms: number) => Promise<void> }).sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    const result = await client.getOrder(ctx, '2885109');

    expect(result.data.fulfill_status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(5_250);
  });

  it('POST /order lỗi mạng ⇒ NETWORK, KHÔNG tự thử lại (request có thể đã tới nơi)', async () => {
    const { client, fetchMock } = build([new Error('socket hang up')]);
    const error = (await client
      .createOrder(ctx, {
        ref_id: 'TT-1',
        order_status: 'new_order',
        shipping_method: 'standard',
        line_items: [],
      })
      .catch((caught: unknown) => caught)) as FulfillmentClientError;
    expect(error.errorClass).toBe(FulfillmentErrorClass.NETWORK);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET huỷ đơn KHÔNG tự thử lại (thay đổi dữ liệu dù là GET)', async () => {
    const { client, fetchMock } = build([response(503, 'down', 'text/html')]);
    await client.cancelOrder(ctx, '2885109').catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Key KHÔNG lọt vào thông điệp lỗi hay body lỗi lưu lại (kể cả khi Pressify lặp lại key)', async () => {
    const { client } = build([
      response(400, { data: '', msg: `bad request for ${KEY}`, api_key: KEY, status: 'error' }),
    ]);

    const error = (await client
      .listOrders(ctx, {})
      .catch((caught: unknown) => caught)) as FulfillmentClientError;

    expect(error.message).not.toContain(KEY);
    expect(JSON.stringify(error.rawBody)).not.toContain(KEY);
    expect(error.endpoint).toBe('GET /orders');
  });

  it('Redirect thay cho JSON ⇒ lỗi rõ ràng, không đi theo', async () => {
    const { client } = build([response(302, '')]);
    const error = (await client
      .listAccessories(ctx)
      .catch((caught: unknown) => caught)) as FulfillmentClientError;
    expect(error.providerCode).toBe('UNEXPECTED_REDIRECT');
  });
});
