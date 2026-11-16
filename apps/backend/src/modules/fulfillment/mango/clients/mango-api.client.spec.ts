import { ConfigService } from '@nestjs/config';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import { MangoApiClient } from './mango-api.client';

/**
 * **Phân loại lỗi của Mango** — envelope `{ code, status: false }` được ưu tiên hơn HTTP status vì Mango trả lỗi
 * nghiệp vụ kèm HTTP 200.
 *
 * 🔴 Lỗi thật 2026-11-16 (đơn 577683942045225361): `GET /orders/{order_id}` khi không có đơn trả HTTP 200 +
 * `code: "ORDER_NOT_FOUND"`. Bị phân loại UNKNOWN ⇒ "Retry fulfill" dừng ở bước tra chống trùng (7 lần bấm, không
 * lần nào gửi lại), và đơn 577674520376873273 kẹt SUBMITTING từ 2026-11-12.
 */

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function setup(status: number, body: unknown) {
  const fetchMock = jest.fn(() => Promise.resolve(response(status, body)));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  const client = new MangoApiClient({
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService);
  jest.spyOn(client as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
  return { client, fetchMock };
}

const getOrderError = async (status: number, body: unknown) => {
  const { client, fetchMock } = setup(status, body);
  const error = await client
    .getOrder({ apiKey: 'KEY' }, 'NC-577683942045225361')
    .then(() => null)
    .catch((caught: unknown) => caught);
  return { error: error as FulfillmentClientError, calls: fetchMock.mock.calls.length };
};

describe('MangoApiClient — phân loại lỗi', () => {
  it('HTTP 200 + code ORDER_NOT_FOUND (response thật) ⇒ NOT_FOUND, KHÔNG thử lại', async () => {
    const { error, calls } = await getOrderError(200, {
      code: 'ORDER_NOT_FOUND',
      data: null,
      status: false,
      message: 'Order not found',
      request_id: 'ff9e4d95-b838-409e-830f-f260778d7510',
    });
    expect(error).toBeInstanceOf(FulfillmentClientError);
    expect(error.errorClass).toBe(FulfillmentErrorClass.NOT_FOUND);
    expect(error.retryable).toBe(false);
    expect(error.providerCode).toBe('ORDER_NOT_FOUND');
    expect(calls).toBe(1);
  });

  it('mã NOT_FOUND chung / HTTP 404 ⇒ NOT_FOUND (như cũ)', async () => {
    expect((await getOrderError(200, { code: 'NOT_FOUND', status: false, message: 'Resource not found' })).error.errorClass).toBe(
      FulfillmentErrorClass.NOT_FOUND,
    );
    expect((await getOrderError(404, { message: 'nope' })).error.errorClass).toBe(FulfillmentErrorClass.NOT_FOUND);
  });

  it('PRICING_ERROR (thiếu mockup) vẫn là UNKNOWN — KHÔNG bị coi là "không có đơn"', async () => {
    const { error } = await getOrderError(200, {
      code: 'PRICING_ERROR',
      status: false,
      message: "Order pricing failed: ['Item 1 (12128): Missing required mockups: front']",
    });
    expect(error.errorClass).toBe(FulfillmentErrorClass.UNKNOWN);
  });

  it('429 / RATE_LIMIT_EXCEEDED vẫn là RATE_LIMIT (thử lại có giới hạn)', async () => {
    const { error, calls } = await getOrderError(429, { code: 'RATE_LIMIT_EXCEEDED', status: false, message: 'slow down' });
    expect(error.errorClass).toBe(FulfillmentErrorClass.RATE_LIMIT);
    expect(calls).toBeGreaterThan(1);
  });
});
