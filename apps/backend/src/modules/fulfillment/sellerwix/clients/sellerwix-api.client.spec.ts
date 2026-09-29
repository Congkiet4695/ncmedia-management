import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import type { SellerwixCallContext } from '../services/sellerwix-credential.service';
import { SellerwixApiClient } from './sellerwix-api.client';

/**
 * **Cửa ra Sellerwix Public API.**
 *
 * Khoá lại hợp đồng xác thực trong tài liệu (OAuth2 Client Credentials + JWT Bearer RS256), cách
 * nhớ token, và luật thử lại: GET thử lại lỗi tạm thời, POST tạo đơn KHÔNG BAO GIỜ tự thử lại.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CTX: SellerwixCallContext = {
  accountId: 'acc-swx',
  tokenCacheKey: 'acc-swx:1',
  apiKey: 'API-KEY-XYZ',
  publicKeyId: '91cabfd5-78fb-4bbd-9000-a4c0fa258c20',
  privateKeyPem: privateKey,
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

const TOKEN_OK = response(200, { access_token: 'tok-1', token_type: 'Bearer', expires_in: 1800 });
const isToken = (call: FetchCall) => call.url.endsWith('/oauth2/token');

describe('SellerwixApiClient — xác thực OAuth2 JWT Bearer (RS256)', () => {
  it('đổi token đúng form tài liệu; JWT ký RS256 với kid = Public Key ID, iss = sub = API Key, jti mới', async () => {
    const { client, calls } = setup((call) => (isToken(call) ? TOKEN_OK : response(200, [])));

    await client.listCategories(CTX);

    const tokenCall = calls[0];
    expect(tokenCall.url).toBe('https://api.sellerwix.test/public-api/oauth2/token');
    expect((tokenCall.init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(tokenCall.init.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );

    const [headerB64, payloadB64, signatureB64] = String(form.get('client_assertion')).split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as Record<
      string,
      string
    >;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      iss: string;
      sub: string;
      jti: string;
      iat: number;
      exp: number;
    };
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: CTX.publicKeyId });
    expect(payload.iss).toBe(CTX.apiKey);
    expect(payload.sub).toBe(CTX.apiKey);
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.exp - payload.iat).toBe(600);
    // Chữ ký kiểm được bằng PUBLIC KEY (thứ người dùng upload lên Sellerwix).
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${headerB64}.${payloadB64}`),
        publicKey,
        Buffer.from(signatureB64, 'base64url'),
      ),
    ).toBe(true);

    // Lời gọi API mang Bearer token vừa đổi.
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('token còn hạn ⇒ dùng lại, không đổi token cho mỗi request', async () => {
    const { client, calls } = setup((call) => (isToken(call) ? TOKEN_OK : response(200, [])));

    await client.listCategories(CTX);
    await client.listCategories(CTX);

    expect(calls.filter(isToken)).toHaveLength(1);
  });

  it('401 (token bị thu hồi) ⇒ bỏ token, đổi token mới, gửi lại ĐÚNG MỘT lần', async () => {
    let apiCalls = 0;
    const { client, calls } = setup((call) => {
      if (isToken(call)) return TOKEN_OK;
      apiCalls += 1;
      return apiCalls === 1
        ? response(401, { code: 401, message: 'unauthorized' })
        : response(200, []);
    });

    await client.listCategories(CTX);

    expect(calls.filter(isToken)).toHaveLength(2);
    expect(apiCalls).toBe(2);
  });

  it('khoá sai ⇒ lỗi AUTH, không thử lại vô hạn', async () => {
    const { client, calls } = setup(() => response(401, { code: 401, message: 'invalid_client' }));

    const error = await client.listCategories(CTX).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FulfillmentClientError);
    expect((error as FulfillmentClientError).errorClass).toBe(FulfillmentErrorClass.AUTH);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('không có access_token trong response ⇒ AUTH, nêu rõ', async () => {
    const { client } = setup(() => response(200, {}));
    await expect(client.listCategories(CTX)).rejects.toThrow(/access_token/);
  });
});

describe('SellerwixApiClient — thử lại & phân loại lỗi', () => {
  it('GET gặp 500 ⇒ thử lại (tối đa 3 lần)', async () => {
    let attempts = 0;
    const { client } = setup((call) => {
      if (isToken(call)) return TOKEN_OK;
      attempts += 1;
      return attempts < 3
        ? response(500, { code: 500, message: 'Internal Server Error' })
        : response(200, []);
    });

    await client.listCategories(CTX);
    expect(attempts).toBe(3);
  });

  it('🔴 POST tạo đơn gặp 500 ⇒ KHÔNG tự thử lại (có thể đã tạo ở Sellerwix)', async () => {
    let creates = 0;
    const { client } = setup((call) => {
      if (isToken(call)) return TOKEN_OK;
      creates += 1;
      return response(500, { code: 500, message: 'Internal Server Error' });
    });

    const error = await client
      .createOrder(CTX, {
        store_id: 'store-1',
        line_items: [],
        address: { name: 'a', address1: 'b', city: 'c', zip: 'd', country: 'US' },
      })
      .catch((caught: unknown) => caught);

    expect(creates).toBe(1);
    expect((error as FulfillmentClientError).errorClass).toBe(FulfillmentErrorClass.SERVER);
    expect((error as FulfillmentClientError).retryable).toBe(true);
  });

  it('timeout / lỗi mạng ⇒ NETWORK (thử lại được), mang mã tương quan', async () => {
    const { client, fetchMock } = setup((call) => (isToken(call) ? TOKEN_OK : response(200, {})));
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/oauth2/token')
        ? Promise.resolve(TOKEN_OK)
        : Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );

    const error = (await client
      .createOrder(CTX, {
        store_id: 'store-1',
        line_items: [],
        address: { name: 'a', address1: 'b', city: 'c', zip: 'd', country: 'US' },
      })
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
      const { client } = setup((call) => (isToken(call) ? TOKEN_OK : response(status, body)));

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
    const { client, calls } = setup((call) =>
      isToken(call) ? TOKEN_OK : response(200, { id: 'x' }),
    );

    await client.getOrderByReference(CTX, '576000000000000001');

    expect(calls[1].url).toBe(
      'https://api.sellerwix.test/public-api/v1/order/576000000000000001?store_id=store-1',
    );
    expect(calls[1].init.method).toBe('GET');
  });

  it('biến thể: limit=100 và next_page là cursor', async () => {
    const { client, calls } = setup((call) =>
      isToken(call) ? TOKEN_OK : response(200, { data: [] }),
    );

    await client.listVariants(CTX, 'SW-MD-MPTG', 'cursor-2');

    expect(calls[1].url).toBe(
      'https://api.sellerwix.test/public-api/v1/product/SW-MD-MPTG?limit=100&next_page=cursor-2',
    );
  });
});
