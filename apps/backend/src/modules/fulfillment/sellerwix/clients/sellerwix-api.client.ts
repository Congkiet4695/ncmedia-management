import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, sign } from 'node:crypto';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import {
  SELLERWIX_DEFAULT_BASE_URL,
  SELLERWIX_ENDPOINTS,
  SELLERWIX_JWT,
  SELLERWIX_MIN_INTERVAL_MS,
  SELLERWIX_RETRY,
  SELLERWIX_TOKEN_REFRESH_MARGIN_MS,
  SELLERWIX_TOKEN_REQUEST,
  SELLERWIX_VARIANT_PAGE_LIMIT,
} from '../constants/sellerwix.constants';
import type { SellerwixCallContext } from '../services/sellerwix-credential.service';
import type {
  SellerwixCancelOrderRequest,
  SellerwixCategory,
  SellerwixCategoryProduct,
  SellerwixCreateOrderRequest,
  SellerwixCreateOrderResponse,
  SellerwixErrorBody,
  SellerwixOrder,
  SellerwixShippingMethod,
  SellerwixTokenResponse,
  SellerwixVariantPage,
} from '../types/sellerwix-api.types';

/** Kết quả một lần gọi, kèm metadata để ghi nhật ký/đối soát. */
export interface SellerwixResult<T> {
  data: T;
  /**
   * Mã tương quan do NCMedia sinh cho lời gọi này.
   *
   * ⚠️ Tài liệu Sellerwix KHÔNG định nghĩa request id trong response. Mã này chỉ nằm trong log
   * của NCMedia (không gửi sang Sellerwix) để nối `fulfillment_histories` ↔ log ứng dụng.
   */
  requestId: string;
  durationMs: number;
  httpStatus: number;
}

/** Nhóm điều tiết tần suất — mỗi nhóm một mốc "được gửi sớm nhất" riêng. */
type ThrottleBucket = keyof typeof SELLERWIX_MIN_INTERVAL_MS;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * SellerwixApiClient — cửa DUY NHẤT ra Sellerwix Public API.
 *
 * - **Xác thực**: OAuth 2.0 Client Credentials + JWT Bearer Assertion RS256 (tài liệu
 *   Authentication, 2026-06-03). Access token (30 phút) được nhớ trong bộ nhớ theo tài khoản và
 *   làm mới trước hạn; hai lời gọi song song dùng chung MỘT lần đổi token.
 * - **Điều tiết**: 100 req/60s toàn API, riêng Get order details 15 req/phút (tài liệu).
 * - **Thử lại**: chỉ GET, chỉ lỗi tạm thời (RATE_LIMIT/NETWORK/SERVER). POST tạo đơn KHÔNG BAO
 *   GIỜ tự thử lại — request timeout có thể đã tới nơi; tầng service kiểm tra tồn tại theo
 *   `reference_id` trước khi gửi lại.
 * - **401 một lần**: token có thể bị thu hồi trước hạn ⇒ bỏ token, đổi token mới, gửi lại ĐÚNG MỘT
 *   lần. An toàn cả với POST vì 401 nghĩa là request bị từ chối trước khi được xử lý.
 *
 * 🔴 KHÔNG ghi API key, private key, JWT, access token hay body request/response vào log.
 */
@Injectable()
export class SellerwixApiClient {
  private readonly logger = new Logger(SellerwixApiClient.name);

  private readonly tokens = new Map<string, CachedToken>();
  private readonly pendingTokens = new Map<string, Promise<string>>();
  private readonly nextSlotAt = new Map<ThrottleBucket, number>();

  constructor(private readonly config: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  listCategories(ctx: SellerwixCallContext): Promise<SellerwixResult<SellerwixCategory[]>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.categories);
  }

  listCategoryProducts(
    ctx: SellerwixCallContext,
    categoryId: string | number,
  ): Promise<SellerwixResult<SellerwixCategoryProduct[]>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.categoryProducts(categoryId));
  }

  listVariants(
    ctx: SellerwixCallContext,
    productSku: string,
    nextPage?: string | null,
  ): Promise<SellerwixResult<SellerwixVariantPage>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.productVariants(productSku), {
      query: { limit: SELLERWIX_VARIANT_PAGE_LIMIT, next_page: nextPage ?? undefined },
    });
  }

  listShippingMethods(
    ctx: SellerwixCallContext,
    variantSku: string,
  ): Promise<SellerwixResult<SellerwixShippingMethod[]>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.variantShippingMethods(variantSku));
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  createOrder(
    ctx: SellerwixCallContext,
    body: SellerwixCreateOrderRequest,
  ): Promise<SellerwixResult<SellerwixCreateOrderResponse>> {
    return this.call(ctx, 'POST', SELLERWIX_ENDPOINTS.createOrder, { body });
  }

  /** Chi tiết đơn theo `id` phía Sellerwix. */
  getOrder(ctx: SellerwixCallContext, orderId: string): Promise<SellerwixResult<SellerwixOrder>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.orderDetail(orderId), {
      bucket: 'orderDetail',
    });
  }

  /**
   * Chi tiết đơn theo `reference_id` NCMedia đã gửi (changelog 2026-04-07: có `store_id` trên
   * query ⇒ `:id` là reference_id). HTTP 404 ⇒ `FulfillmentClientError` lớp `NOT_FOUND`.
   */
  getOrderByReference(
    ctx: SellerwixCallContext,
    referenceId: string,
  ): Promise<SellerwixResult<SellerwixOrder>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.orderDetail(referenceId), {
      bucket: 'orderDetail',
      query: { store_id: ctx.storeId },
    });
  }

  cancelOrder(
    ctx: SellerwixCallContext,
    orderId: string,
    body: SellerwixCancelOrderRequest,
  ): Promise<SellerwixResult<SellerwixOrder>> {
    return this.call(ctx, 'POST', SELLERWIX_ENDPOINTS.cancelOrder(orderId), { body });
  }

  /**
   * Chỉ đổi token — dùng cho Test Connection để tách rõ "sai khoá" với "sai quyền/endpoint".
   * Luôn đổi token MỚI (bỏ qua bộ nhớ đệm) vì mục đích là kiểm tra khoá hiện tại.
   */
  async verifyCredentials(ctx: SellerwixCallContext): Promise<{ durationMs: number }> {
    const startedAt = Date.now();
    this.tokens.delete(ctx.tokenCacheKey);
    await this.accessToken(ctx);
    return { durationMs: Date.now() - startedAt };
  }

  // ---------------------------------------------------------------------------
  // Xác thực
  // ---------------------------------------------------------------------------

  /** Access token còn hạn, hoặc đổi token mới (dùng chung một lần đổi cho lời gọi song song). */
  private async accessToken(ctx: SellerwixCallContext): Promise<string> {
    const cached = this.tokens.get(ctx.tokenCacheKey);
    if (cached && cached.expiresAt - SELLERWIX_TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    const pending = this.pendingTokens.get(ctx.tokenCacheKey);
    if (pending) return pending;

    const request = this.exchangeToken(ctx).finally(() =>
      this.pendingTokens.delete(ctx.tokenCacheKey),
    );
    this.pendingTokens.set(ctx.tokenCacheKey, request);
    return request;
  }

  private async exchangeToken(ctx: SellerwixCallContext): Promise<string> {
    const assertion = this.buildAssertion(ctx);
    const form = new URLSearchParams({
      grant_type: SELLERWIX_TOKEN_REQUEST.grantType,
      client_assertion_type: SELLERWIX_TOKEN_REQUEST.clientAssertionType,
      client_assertion: assertion,
    });

    const response = await this.send<SellerwixTokenResponse>(
      ctx,
      'POST',
      SELLERWIX_ENDPOINTS.token,
      {
        rawBody: form.toString(),
        contentType: 'application/x-www-form-urlencoded',
        authorization: null,
      },
    );

    const token = response.data?.access_token?.trim();
    if (!token) {
      throw new FulfillmentClientError(
        FulfillmentErrorClass.AUTH,
        'Sellerwix không trả access_token khi đổi JWT assertion.',
        response.httpStatus,
        undefined,
        undefined,
        response.requestId,
        undefined,
        `POST ${SELLERWIX_ENDPOINTS.token}`,
      );
    }

    const expiresInSeconds =
      typeof response.data.expires_in === 'number' && response.data.expires_in > 0
        ? response.data.expires_in
        : null;
    // Không có `expires_in` ⇒ KHÔNG đoán hạn: dùng token cho đúng lời gọi này, lần sau đổi lại.
    if (expiresInSeconds) {
      this.tokens.set(ctx.tokenCacheKey, {
        token,
        expiresAt: Date.now() + expiresInSeconds * 1000,
      });
    }
    return token;
  }

  /**
   * JWT assertion theo tài liệu (Step 5.1): header `alg=RS256`, `kid` = Public Key ID; payload
   * `iss` = `sub` = API Key, `jti` là UUID MỚI mỗi lần (chống replay), `exp` (giây).
   *
   * Tự ký bằng `node:crypto` thay vì thêm thư viện: đúng một thuật toán, không cần gì khác.
   */
  private buildAssertion(ctx: SellerwixCallContext): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: SELLERWIX_JWT.algorithm, typ: 'JWT', kid: ctx.publicKeyId };
    const payload = {
      iss: ctx.apiKey,
      sub: ctx.apiKey,
      jti: randomUUID(),
      iat: now,
      exp: now + SELLERWIX_JWT.assertionTtlSeconds,
    };
    const signingInput = `${this.base64Url(JSON.stringify(header))}.${this.base64Url(
      JSON.stringify(payload),
    )}`;

    let signature: Buffer;
    try {
      signature = sign('RSA-SHA256', Buffer.from(signingInput), ctx.privateKeyPem);
    } catch {
      throw new FulfillmentClientError(
        FulfillmentErrorClass.AUTH,
        'Không ký được JWT bằng private key đã lưu — kiểm tra lại Private Key của tài khoản Sellerwix.',
      );
    }
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  private base64Url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  // ---------------------------------------------------------------------------
  // Gửi request
  // ---------------------------------------------------------------------------

  /** Lời gọi có xác thực + điều tiết + thử lại (chỉ GET) + đổi token lại một lần khi 401. */
  private async call<T>(
    ctx: SellerwixCallContext,
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      bucket?: ThrottleBucket;
    } = {},
  ): Promise<SellerwixResult<T>> {
    const maxAttempts = method === 'GET' ? SELLERWIX_RETRY.maxAttempts : 1;
    const fullPath = this.withQuery(path, options.query ?? {});
    let tokenRefreshed = false;

    for (let attempt = 1; ; attempt += 1) {
      try {
        const token = await this.accessToken(ctx);
        return await this.send<T>(ctx, method, fullPath, {
          rawBody: options.body === undefined ? undefined : JSON.stringify(options.body),
          contentType: 'application/json',
          authorization: token,
          bucket: options.bucket,
        });
      } catch (error) {
        const clientError = error instanceof FulfillmentClientError ? error : undefined;

        if (clientError?.httpStatus === 401 && !tokenRefreshed) {
          tokenRefreshed = true;
          this.tokens.delete(ctx.tokenCacheKey);
          attempt -= 1;
          continue;
        }
        if (!clientError?.retryable || attempt >= maxAttempts) throw error;

        const delayMs = this.retryDelayMs(attempt);
        this.logger.warn({
          module: 'fulfillment',
          provider: 'SELLERWIX',
          operation: `${method} ${path}`,
          attempt,
          maxAttempts,
          errorClass: clientError.errorClass,
          httpStatus: clientError.httpStatus,
          requestId: clientError.requestId,
          delayMs,
          msg: `Lỗi tạm thời, thử lại lần ${attempt + 1}/${maxAttempts} sau ${delayMs}ms`,
        });
        await this.sleep(delayMs);
      }
    }
  }

  /** MỘT lần gọi thật — không thử lại. */
  private async send<T>(
    ctx: SellerwixCallContext,
    method: 'GET' | 'POST',
    path: string,
    options: {
      rawBody?: string;
      contentType: string;
      authorization: string | null;
      bucket?: ThrottleBucket;
    },
  ): Promise<SellerwixResult<T>> {
    await this.throttle('global');
    if (options.bucket && options.bucket !== 'global') await this.throttle(options.bucket);

    const baseUrl =
      ctx.baseUrl ||
      this.config.get<string>('fulfillment.sellerwix.baseUrl', SELLERWIX_DEFAULT_BASE_URL);
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    const timeoutMs = this.config.get<number>('fulfillment.sellerwix.timeoutMs', 30_000);
    const requestId = randomUUID();
    const endpoint = `${method} ${path.split('?')[0]}`;

    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': options.contentType,
    };
    if (options.authorization) headers.authorization = `Bearer ${options.authorization}`;

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.rawBody,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      throw new FulfillmentClientError(
        FulfillmentErrorClass.NETWORK,
        aborted
          ? `Sellerwix không phản hồi sau ${timeoutMs}ms`
          : `Lỗi mạng khi gọi Sellerwix: ${(error as Error).message}`,
        undefined,
        undefined,
        undefined,
        requestId,
        undefined,
        endpoint,
      );
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    const rawText = await response.text();
    const parsed = this.parseJson(rawText);

    this.logger.log({
      module: 'fulfillment',
      provider: 'SELLERWIX',
      accountId: ctx.accountId,
      operation: endpoint,
      httpStatus: response.status,
      requestId,
      durationMs,
      msg: 'Gọi Sellerwix API',
    });

    if (!response.ok) {
      throw this.toClientError(response.status, parsed, rawText, endpoint, requestId);
    }
    return { data: parsed as T, requestId, durationMs, httpStatus: response.status };
  }

  /**
   * Phân loại lỗi theo HTTP status — tài liệu Sellerwix KHÔNG có bảng mã lỗi nghiệp vụ, chỉ có
   * ví dụ `{ code, message }` / `{ error, message }` kèm 400/401/404/429/500.
   */
  private toClientError(
    httpStatus: number,
    parsed: unknown,
    rawText: string,
    endpoint: string,
    requestId: string,
  ): FulfillmentClientError {
    const body = (parsed && typeof parsed === 'object' ? parsed : {}) as SellerwixErrorBody;
    const providerCode =
      typeof body.error === 'string' && body.error
        ? body.error
        : body.code !== undefined && body.code !== null
          ? String(body.code)
          : `HTTP_${httpStatus}`;
    const message =
      (typeof body.message === 'string' && body.message.trim()) ||
      rawText.trim().slice(0, 500) ||
      `Sellerwix trả về HTTP ${httpStatus}`;

    let errorClass = FulfillmentErrorClass.UNKNOWN;
    if (httpStatus === 401 || httpStatus === 403) errorClass = FulfillmentErrorClass.AUTH;
    else if (httpStatus === 404) errorClass = FulfillmentErrorClass.NOT_FOUND;
    else if (httpStatus === 400 || httpStatus === 422)
      errorClass = FulfillmentErrorClass.VALIDATION;
    else if (httpStatus === 429) errorClass = FulfillmentErrorClass.RATE_LIMIT;
    else if (httpStatus >= 500) errorClass = FulfillmentErrorClass.SERVER;

    return new FulfillmentClientError(
      errorClass,
      message,
      httpStatus,
      providerCode,
      undefined,
      requestId,
      // Body lỗi của Sellerwix chỉ có code/message — không mang dữ liệu người nhận.
      parsed ?? rawText.slice(0, 4000),
      endpoint,
    );
  }

  private withQuery(path: string, query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /**
   * Giãn cách theo nhóm. Cộng dồn mốc thay vì ngủ cố định để lời gọi song song mỗi cái nhận một
   * khe riêng. Bộ đếm là của TIẾN TRÌNH: trần tần suất nằm ở phía nhà cung cấp.
   */
  private async throttle(bucket: ThrottleBucket): Promise<void> {
    const interval = SELLERWIX_MIN_INTERVAL_MS[bucket];
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt.get(bucket) ?? 0);
    this.nextSlotAt.set(bucket, slot + interval);
    if (slot > now) await this.sleep(slot - now);
  }

  private retryDelayMs(attempt: number): number {
    const backoff = SELLERWIX_RETRY.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * SELLERWIX_RETRY.jitterMs);
    return Math.min(backoff + jitter, SELLERWIX_RETRY.maxDelayMs);
  }

  private parseJson(text: string): unknown {
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
