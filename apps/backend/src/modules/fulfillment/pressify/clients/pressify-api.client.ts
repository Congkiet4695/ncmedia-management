import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import {
  PRESSIFY_DEFAULT_BASE_URL,
  PRESSIFY_ENDPOINTS,
  PRESSIFY_MIN_INTERVAL_MS,
  PRESSIFY_RETRY,
} from '../constants/pressify.constants';
import type { PressifyCallContext } from '../services/pressify-credential.service';
import type {
  PressifyAccessory,
  PressifyAllProductsResponse,
  PressifyCancelResponse,
  PressifyCreateOrderRequest,
  PressifyCreateOrderResponse,
  PressifyEnvelope,
  PressifyOrder,
  PressifyOrderListResponse,
} from '../types/pressify-api.types';

/** Kết quả một lần gọi, kèm metadata để ghi nhật ký / đối soát. */
export interface PressifyResult<T> {
  data: T;
  /** Mã tương quan do NCMedia sinh (Pressify không trả request id) — chỉ nằm trong log của NCMedia. */
  requestId: string;
  durationMs: number;
  httpStatus: number;
}

type ThrottleBucket = keyof typeof PRESSIFY_MIN_INTERVAL_MS;

/** Body tạo đơn KHÔNG có key — client tự gắn `api_key` ngay trước khi gửi (không object nào khác giữ key). */
export type PressifyCreateOrderBody = Omit<PressifyCreateOrderRequest, 'api_key'>;

/** Mã `providerCode` cho đơn bị quy tắc nghiệp vụ Pressify từ chối (HTTP 500 kèm `msg`). */
export const PRESSIFY_BUSINESS_RULE_CODE = 'PRESSIFY_BUSINESS_RULE';

/**
 * PressifyApiClient — cửa DUY NHẤT ra Pressify Seller API.
 *
 * - **Xác thực** (tài liệu "Authentication"): Store API key gửi ở query string `api_key` với GET và trong
 *   body JSON với POST. Danh mục (GET /all-product) không cần key.
 * - **Header bắt buộc** (tài liệu "Overview"): `Content-Type: application/json` + `Accept: application/json`
 *   — thiếu Accept thì lỗi validate có thể về dạng redirect. `redirect: 'manual'` để một redirect như vậy
 *   thành lỗi rõ ràng thay vì bị đi theo âm thầm.
 * - **Điều tiết**: theo bảng giới hạn per-IP của tài liệu (`PRESSIFY_MIN_INTERVAL_MS`).
 * - **Thử lại**: chỉ GET chỉ-đọc, chỉ lỗi tạm thời (RATE_LIMIT / NETWORK / SERVER). POST /order và
 *   GET /order/cancel KHÔNG BAO GIỜ tự thử lại.
 *
 * 🔴 Key nằm trên URL ⇒ KHÔNG BAO GIỜ log URL / query string; log chỉ có `METHOD /path`. Mọi chuỗi lỗi
 * và body lỗi được che key trước khi rời client.
 */
@Injectable()
export class PressifyApiClient {
  private readonly logger = new Logger(PressifyApiClient.name);
  private readonly nextSlotAt = new Map<ThrottleBucket, number>();

  constructor(private readonly config: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Danh mục / tài khoản
  // ---------------------------------------------------------------------------

  /** Toàn bộ sản phẩm đang bán (một response, không phân trang). Không cần key. */
  listAllProducts(baseUrl?: string | null): Promise<PressifyResult<PressifyAllProductsResponse>> {
    return this.call(null, 'GET', PRESSIFY_ENDPOINTS.allProducts, {
      bucket: 'catalog',
      retry: true,
      baseUrl,
    });
  }

  /** Phụ kiện theo bậc của store — kiểm được Store API key (404 "invalid seller" khi key sai). */
  listAccessories(
    ctx: PressifyCallContext,
  ): Promise<PressifyResult<PressifyEnvelope<PressifyAccessory[]>>> {
    return this.call(ctx, 'GET', PRESSIFY_ENDPOINTS.accessories, {
      bucket: 'accessories',
      retry: true,
      auth: 'query',
    });
  }

  // ---------------------------------------------------------------------------
  // Đơn hàng
  // ---------------------------------------------------------------------------

  createOrder(
    ctx: PressifyCallContext,
    body: PressifyCreateOrderBody,
  ): Promise<PressifyResult<PressifyCreateOrderResponse>> {
    return this.call(ctx, 'POST', PRESSIFY_ENDPOINTS.createOrder, {
      bucket: 'createOrder',
      retry: false,
      auth: 'body',
      body,
    });
  }

  /** Chi tiết đơn (KHÔNG bọc trong `data`). */
  getOrder(ctx: PressifyCallContext, orderId: string): Promise<PressifyResult<PressifyOrder>> {
    return this.call(ctx, 'GET', PRESSIFY_ENDPOINTS.orderDetail(orderId), {
      bucket: 'orderDetail',
      retry: true,
      auth: 'query',
    });
  }

  /** Một trang đơn của store, mới nhất trước. Khoảng ngày (nếu có) phải đủ hai đầu, tối đa 31 ngày. */
  listOrders(
    ctx: PressifyCallContext,
    query: { dateFrom?: string; dateTo?: string; page?: number; perPage?: number },
  ): Promise<PressifyResult<PressifyOrderListResponse>> {
    return this.call(ctx, 'GET', PRESSIFY_ENDPOINTS.listOrders, {
      bucket: 'listOrders',
      retry: true,
      auth: 'query',
      query: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        page: query.page,
        per_page: query.perPage,
      },
    });
  }

  /**
   * Huỷ đơn. Tài liệu: LUÔN HTTP 200 — kết quả ở `status` ("success" / "error") + `msg`.
   * 🔴 Thay đổi dữ liệu dù là GET ⇒ không tự thử lại.
   */
  cancelOrder(
    ctx: PressifyCallContext,
    orderId: string,
  ): Promise<PressifyResult<PressifyCancelResponse>> {
    return this.call(ctx, 'GET', PRESSIFY_ENDPOINTS.cancelOrder(orderId), {
      bucket: 'cancelOrder',
      retry: false,
      auth: 'query',
    });
  }

  // ---------------------------------------------------------------------------
  // Gửi request
  // ---------------------------------------------------------------------------

  private async call<T>(
    ctx: PressifyCallContext | null,
    method: 'GET' | 'POST',
    path: string,
    options: {
      bucket: ThrottleBucket;
      retry: boolean;
      auth?: 'query' | 'body';
      body?: object;
      query?: Record<string, string | number | undefined>;
      baseUrl?: string | null;
    },
  ): Promise<PressifyResult<T>> {
    const maxAttempts = options.retry ? PRESSIFY_RETRY.maxAttempts : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.send<T>(ctx, method, path, options);
      } catch (error) {
        const clientError = error instanceof FulfillmentClientError ? error : undefined;
        if (!clientError?.retryable || attempt >= maxAttempts) throw error;
        const delayMs = this.retryDelayMs(attempt, clientError.rateLimitResetSeconds);
        this.logger.warn({
          module: 'fulfillment',
          provider: 'PRESSIFY',
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
    ctx: PressifyCallContext | null,
    method: 'GET' | 'POST',
    path: string,
    options: {
      bucket: ThrottleBucket;
      auth?: 'query' | 'body';
      body?: object;
      query?: Record<string, string | number | undefined>;
      baseUrl?: string | null;
    },
  ): Promise<PressifyResult<T>> {
    await this.throttle(options.bucket);

    const apiKey = options.auth ? (ctx?.apiKey ?? '') : '';
    if (options.auth && !apiKey) {
      // Lỗi lập trình (gọi endpoint cần key mà không có ngữ cảnh) — không bao giờ gửi request thiếu key.
      throw new FulfillmentClientError(
        FulfillmentErrorClass.AUTH,
        'Thiếu Store API key của Pressify.',
      );
    }

    const baseUrl =
      options.baseUrl?.trim() ||
      ctx?.baseUrl ||
      this.config.get<string>('fulfillment.pressify.baseUrl', PRESSIFY_DEFAULT_BASE_URL);
    const query = {
      ...(options.query ?? {}),
      ...(options.auth === 'query' ? { api_key: apiKey } : {}),
    };
    const url = `${baseUrl.replace(/\/+$/, '')}${this.withQuery(path, query)}`;
    const timeoutMs = this.config.get<number>('fulfillment.pressify.timeoutMs', 30_000);
    const requestId = randomUUID();
    // 🔴 Chỉ METHOD + path — URL thật mang api_key trên query string.
    const endpoint = `${method} ${path}`;
    const rawBody =
      options.body === undefined
        ? undefined
        : JSON.stringify(
            options.auth === 'body' ? { api_key: apiKey, ...options.body } : options.body,
          );

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(rawBody !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: rawBody,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      throw new FulfillmentClientError(
        FulfillmentErrorClass.NETWORK,
        aborted
          ? `Pressify không phản hồi sau ${timeoutMs}ms`
          : this.redact(`Lỗi mạng khi gọi Pressify: ${(error as Error).message}`, apiKey),
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
    // Pressify trả JSON kể cả khi `content-type` là text/html (đã thấy ở GET /products) ⇒ luôn thử parse.
    const parsed = this.parseJson(rawText);

    this.logger.log({
      module: 'fulfillment',
      provider: 'PRESSIFY',
      accountId: ctx?.accountId ?? null,
      operation: endpoint,
      httpStatus: response.status,
      requestId,
      durationMs,
      msg: 'Gọi Pressify API',
    });

    if (response.status < 200 || response.status >= 300) {
      throw this.toClientError(
        response.status,
        method,
        path,
        parsed,
        rawText,
        endpoint,
        requestId,
        apiKey,
      );
    }
    if (parsed === null && rawText.trim() !== '') {
      throw new FulfillmentClientError(
        FulfillmentErrorClass.UNKNOWN,
        'Pressify trả về dữ liệu không phải JSON.',
        response.status,
        'INVALID_RESPONSE',
        undefined,
        requestId,
        undefined,
        endpoint,
      );
    }
    return { data: parsed as T, requestId, durationMs, httpStatus: response.status };
  }

  /**
   * Phân loại lỗi (tài liệu "Errors and rate limits"):
   *   400 sai/thiếu key hoặc tham số · 404 không có đơn (accessory: key không tồn tại) · 422 field sai ·
   *   429 vượt giới hạn · 500 POST /order bị quy tắc nghiệp vụ từ chối (`msg` nói lý do).
   */
  private toClientError(
    httpStatus: number,
    method: 'GET' | 'POST',
    path: string,
    parsed: unknown,
    rawText: string,
    endpoint: string,
    requestId: string,
    apiKey: string,
  ): FulfillmentClientError {
    const body = (parsed && typeof parsed === 'object' ? parsed : {}) as PressifyEnvelope<unknown>;
    const providerMessage =
      (typeof body.msg === 'string' && body.msg.trim()) ||
      (typeof body.message === 'string' && body.message.trim()) ||
      (typeof body.error === 'string' && body.error.trim()) ||
      '';
    const message = this.redact(
      providerMessage || rawText.trim().slice(0, 500) || `Pressify trả về HTTP ${httpStatus}`,
      apiKey,
    );
    const keyRejected =
      /api key is invalid|invalid seller|api key is not match|account is not seller/i.test(
        providerMessage,
      );
    const validationErrors = body.errors
      ? Object.entries(body.errors).flatMap(([field, messages]) =>
          (Array.isArray(messages) ? messages : [String(messages)]).map((text) => ({
            field,
            message: this.redact(String(text), apiKey),
          })),
        )
      : undefined;

    let errorClass = FulfillmentErrorClass.UNKNOWN;
    let providerCode = `HTTP_${httpStatus}`;
    if (keyRejected || httpStatus === 401 || httpStatus === 403) {
      errorClass = FulfillmentErrorClass.AUTH;
    } else if (httpStatus === 404) {
      errorClass = FulfillmentErrorClass.NOT_FOUND;
    } else if (httpStatus === 400 || httpStatus === 422) {
      errorClass = FulfillmentErrorClass.VALIDATION;
    } else if (httpStatus === 429) {
      errorClass = FulfillmentErrorClass.RATE_LIMIT;
    } else if (
      httpStatus === 500 &&
      method === 'POST' &&
      path === PRESSIFY_ENDPOINTS.createOrder &&
      body.status === 'error' &&
      providerMessage
    ) {
      // 🔴 HTTP 500 KÈM `{status:"error", msg}` ở POST /order là ĐƠN BỊ TỪ CHỐI (tài liệu), KHÔNG phải sự cố
      // máy chủ: không thử lại, không coi là "có thể đã tạo" (đối soát) — báo nguyên văn lý do.
      errorClass = FulfillmentErrorClass.VALIDATION;
      providerCode = PRESSIFY_BUSINESS_RULE_CODE;
    } else if (httpStatus >= 500) {
      errorClass = FulfillmentErrorClass.SERVER;
    } else if (httpStatus >= 300 && httpStatus < 400) {
      // Redirect thay cho JSON (tài liệu: xảy ra khi thiếu Accept) — không đi theo, báo rõ.
      errorClass = FulfillmentErrorClass.UNKNOWN;
      providerCode = 'UNEXPECTED_REDIRECT';
    }

    return new FulfillmentClientError(
      errorClass,
      message,
      httpStatus,
      providerCode,
      validationErrors,
      requestId,
      this.redactJson(parsed ?? rawText.slice(0, 4000), apiKey),
      endpoint,
      errorClass === FulfillmentErrorClass.RATE_LIMIT
        ? this.blockedSeconds(providerMessage)
        : undefined,
    );
  }

  /** "Too many requests. Blocked for 5 seconds." ⇒ 5. */
  private blockedSeconds(message: string): number | undefined {
    const match = /blocked for (\d+) second/i.exec(message);
    return match ? Number(match[1]) : undefined;
  }

  private withQuery(path: string, query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }

  private async throttle(bucket: ThrottleBucket): Promise<void> {
    const interval = PRESSIFY_MIN_INTERVAL_MS[bucket];
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt.get(bucket) ?? 0);
    this.nextSlotAt.set(bucket, slot + interval);
    if (slot > now) await this.sleep(slot - now);
  }

  private retryDelayMs(attempt: number, resetSeconds?: number): number {
    if (resetSeconds && resetSeconds > 0) {
      return Math.min(resetSeconds * 1000 + 250, PRESSIFY_RETRY.maxDelayMs);
    }
    const backoff = PRESSIFY_RETRY.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * PRESSIFY_RETRY.jitterMs);
    return Math.min(backoff + jitter, PRESSIFY_RETRY.maxDelayMs);
  }

  private parseJson(text: string): unknown {
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  /** Che key trong một chuỗi (thông điệp lỗi có thể lặp lại URL / body). */
  private redact(text: string, apiKey: string): string {
    return apiKey ? text.split(apiKey).join('***') : text;
  }

  private redactJson(value: unknown, apiKey: string): unknown {
    if (!apiKey) return value;
    try {
      return JSON.parse(
        JSON.stringify(value)
          .split(apiKey)
          .join('***')
          .replace(/("api_key"\s*:\s*")[^"]*"/g, '$1***"'),
      ) as unknown;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
