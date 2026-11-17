import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import {
  SELLERWIX_API_KEY_HEADER,
  SELLERWIX_DEFAULT_BASE_URL,
  SELLERWIX_ENDPOINTS,
  SELLERWIX_CATALOG_BACKOFF,
  SELLERWIX_CATALOG_MIN_INTERVAL_CONFIG_KEY,
  SELLERWIX_MIN_INTERVAL_MS,
  SELLERWIX_RETRY,
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

/**
 * SellerwixApiClient — cửa DUY NHẤT ra Sellerwix Public API.
 *
 * - **Xác thực**: CHỈ API Key, header `X-Api-Key` — đúng khai báo `auth` cấp collection của
 *   Postman "Sellerwix API" (`{"type":"apikey","key":"X-Api-Key"}`), kế thừa bởi mọi endpoint
 *   `/v1/*`: danh mục, sản phẩm, biến thể, vận chuyển, đơn hàng. Không OAuth2, không ký JWT.
 * - **Điều tiết**: 100 req/60s toàn API, riêng Get order details 15 req/phút (tài liệu); đồng bộ danh mục giãn
 *   riêng (`catalog`, mặc định 50 req/phút) để luôn còn hạn mức cho tạo đơn / tra đơn.
 * - **Thử lại**: chỉ GET, chỉ lỗi tạm thời (RATE_LIMIT/NETWORK/SERVER). POST tạo đơn KHÔNG BAO
 *   GIỜ tự thử lại — request timeout có thể đã tới nơi; tầng service kiểm tra tồn tại theo
 *   `reference_id` trước khi gửi lại.
 * - **401/403**: API Key sai/bị thu hồi ⇒ lỗi AUTH, KHÔNG thử lại.
 *
 * 🔴 KHÔNG ghi API key hay body request/response vào log.
 */
@Injectable()
export class SellerwixApiClient {
  private readonly logger = new Logger(SellerwixApiClient.name);

  private readonly nextSlotAt = new Map<ThrottleBucket, number>();

  // --- Ưu tiên Fulfillment > danh mục (xem SELLERWIX_CATALOG_BACKOFF) ---
  /** Số thao tác của người dùng (gửi đơn / huỷ / bấm Sync) đang chạy. > 0 ⇒ danh mục nhường. */
  private priorityLeases = 0;
  /** Danh mục được chạy lại từ mốc này (thao tác ưu tiên cuối + `priorityGraceMs`). */
  private backgroundResumeAt = 0;
  /** Danh mục dừng tới mốc này vì vừa có 429. */
  private backgroundPausedUntil = 0;
  /** Số lần 429 liên tiếp chưa có lời gọi danh mục nào thành công — bậc lùi cấp số nhân. */
  private consecutiveRateLimits = 0;

  constructor(private readonly config: ConfigService) {}

  /**
   * Chạy MỘT thao tác của người dùng với quyền ưu tiên: trong lúc chạy (và `priorityGraceMs` sau đó) mọi lời gọi
   * danh mục đứng chờ. Thao tác ưu tiên KHÔNG chờ gì thêm — chỉ tôn trọng nhịp toàn API như trước.
   * Không khoá toàn cục: nhiều thao tác ưu tiên chạy song song được (đếm số lượt).
   */
  async withPriority<T>(operation: string, task: () => Promise<T>): Promise<T> {
    this.priorityLeases += 1;
    this.logger.log({
      module: 'fulfillment',
      provider: 'SELLERWIX',
      event: 'FULFILLMENT_PRIORITY_GRANTED',
      operation,
      activeLeases: this.priorityLeases,
      msg: 'Thao tác Fulfillment được ưu tiên — đồng bộ danh mục nhường',
    });
    try {
      return await task();
    } finally {
      this.priorityLeases -= 1;
      if (this.priorityLeases === 0) {
        this.backgroundResumeAt = Date.now() + SELLERWIX_CATALOG_BACKOFF.priorityGraceMs;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  listCategories(ctx: SellerwixCallContext): Promise<SellerwixResult<SellerwixCategory[]>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.categories, { bucket: 'catalog' });
  }

  listCategoryProducts(
    ctx: SellerwixCallContext,
    categoryId: string | number,
  ): Promise<SellerwixResult<SellerwixCategoryProduct[]>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.categoryProducts(categoryId), { bucket: 'catalog' });
  }

  listVariants(
    ctx: SellerwixCallContext,
    productSku: string,
    nextPage?: string | null,
  ): Promise<SellerwixResult<SellerwixVariantPage>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.productVariants(productSku), {
      bucket: 'catalog',
      query: { limit: SELLERWIX_VARIANT_PAGE_LIMIT, next_page: nextPage ?? undefined },
    });
  }

  listShippingMethods(
    ctx: SellerwixCallContext,
    variantSku: string,
  ): Promise<SellerwixResult<SellerwixShippingMethod[]>> {
    // Dùng khi TẠO ĐƠN (kiểm phương thức vận chuyển), không phải đồng bộ danh mục ⇒ chỉ trần toàn API.
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
    storeId: string,
    referenceId: string,
  ): Promise<SellerwixResult<SellerwixOrder>> {
    return this.call(ctx, 'GET', SELLERWIX_ENDPOINTS.orderDetail(referenceId), {
      bucket: 'orderDetail',
      query: { store_id: storeId },
    });
  }

  cancelOrder(
    ctx: SellerwixCallContext,
    orderId: string,
    body: SellerwixCancelOrderRequest,
  ): Promise<SellerwixResult<SellerwixOrder>> {
    return this.call(ctx, 'POST', SELLERWIX_ENDPOINTS.cancelOrder(orderId), { body });
  }

  // ---------------------------------------------------------------------------
  // Gửi request
  // ---------------------------------------------------------------------------

  /** Lời gọi có xác thực (API Key) + điều tiết + thử lại (chỉ GET, chỉ lỗi tạm thời). */
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
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.send<T>(ctx, method, fullPath, {
          rawBody: options.body === undefined ? undefined : JSON.stringify(options.body),
          contentType: 'application/json',
          bucket: options.bucket,
        });
      } catch (error) {
        const clientError = error instanceof FulfillmentClientError ? error : undefined;
        if (!clientError?.retryable || attempt >= maxAttempts) throw error;

        // Danh mục gặp 429 ⇒ KHÔNG thử lại sau 1–2 s (sẽ lại tranh hạn mức với Fulfillment): lần thử kế tiếp tự chờ hết
        // khoảng dừng ở `awaitBackgroundTurn`. Số lần thử không đổi.
        const background = options.bucket === 'catalog';
        const delayMs =
          background && clientError.errorClass === FulfillmentErrorClass.RATE_LIMIT ? 0 : this.retryDelayMs(attempt);
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
        if (delayMs > 0) await this.sleep(delayMs);
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
      bucket?: ThrottleBucket;
    },
  ): Promise<SellerwixResult<T>> {
    // Nhóm riêng TRƯỚC, khe toàn API SAU: khe toàn API phải được giữ đúng lúc gửi. Ngược lại (cũ) thì lời gọi giữ
    // khe toàn API rồi còn chờ nhóm riêng tới 4 s ⇒ lúc gửi thật lệch khỏi khe đã giữ, các request dồn cục.
    const background = options.bucket === 'catalog';
    if (background) {
      // Chờ lượt → giữ khe → KIỂM LẠI: trong lúc ngủ chờ khe (tới vài giây) có thể vừa bắt đầu một lượt gửi đơn hoặc
      // một khoảng dừng 429 ⇒ nhường tiếp. Khe đã giữ mà không dùng chỉ là một khoảng trống, không vượt trần.
      for (;;) {
        await this.awaitBackgroundTurn(ctx.accountId, path);
        await this.throttle('catalog');
        await this.throttle('global');
        if (!this.backgroundMustYield()) break;
      }
    } else {
      if (options.bucket && options.bucket !== 'global') await this.throttle(options.bucket);
      await this.throttle('global');
    }

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
      [SELLERWIX_API_KEY_HEADER]: ctx.apiKey,
    };

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
      const retryAfterSeconds =
        response.status === 429 ? parseRetryAfterSeconds(response.headers?.get?.('retry-after') ?? null) : undefined;
      const error = this.toClientError(response.status, parsed, rawText, endpoint, requestId, retryAfterSeconds);
      if (error.errorClass === FulfillmentErrorClass.RATE_LIMIT) {
        this.onRateLimited(ctx.accountId, endpoint, background, retryAfterSeconds);
      }
      throw error;
    }
    if (background) this.consecutiveRateLimits = 0;
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
    retryAfterSeconds?: number,
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
      retryAfterSeconds,
    );
  }

  /**
   * Danh mục đứng chờ khi: đang có thao tác ưu tiên (hoặc vừa xong < `priorityGraceMs`), hoặc đang trong khoảng dừng
   * sau 429. Chỉ lời gọi NỀN đi qua đây — Fulfillment không bao giờ.
   */
  private backgroundMustYield(now: number = Date.now()): boolean {
    return this.priorityLeases > 0 || now < this.backgroundResumeAt || now < this.backgroundPausedUntil;
  }

  private async awaitBackgroundTurn(accountId: string, path: string): Promise<void> {
    let pausedFor: 'FULFILLMENT' | 'RATE_LIMIT' | null = null;
    for (;;) {
      const now = Date.now();
      const reason =
        this.priorityLeases > 0 || now < this.backgroundResumeAt
          ? 'FULFILLMENT'
          : now < this.backgroundPausedUntil
            ? 'RATE_LIMIT'
            : null;
      if (!reason) break;
      if (reason !== pausedFor) {
        pausedFor = reason;
        this.logger.log({
          module: 'fulfillment',
          provider: 'SELLERWIX',
          event: reason === 'FULFILLMENT' ? 'CATALOG_PAUSED_FOR_FULFILLMENT' : 'CATALOG_BACKOFF',
          accountId,
          operation: `GET ${path.split('?')[0]}`,
          activeLeases: this.priorityLeases,
          resumeInMs: reason === 'RATE_LIMIT' ? this.backgroundPausedUntil - now : undefined,
          msg:
            reason === 'FULFILLMENT'
              ? 'Đồng bộ danh mục tạm dừng — nhường thao tác Fulfillment'
              : 'Đồng bộ danh mục tạm dừng sau 429 (lùi có nhiễu)',
        });
      }
      const waitMs =
        reason === 'RATE_LIMIT'
          ? this.backgroundPausedUntil - now
          : this.priorityLeases > 0
            ? SELLERWIX_CATALOG_BACKOFF.pollMs
            : this.backgroundResumeAt - now;
      await this.sleep(Math.max(1, waitMs));
    }
    if (pausedFor) {
      this.logger.log({
        module: 'fulfillment',
        provider: 'SELLERWIX',
        event: 'CATALOG_RESUMED',
        accountId,
        msg: 'Đồng bộ danh mục chạy tiếp',
      });
    }
  }

  /** 429 ở BẤT KỲ lời gọi nào ⇒ dừng luồng danh mục (Retry-After nếu có, không thì lùi cấp số nhân + nhiễu). */
  private onRateLimited(
    accountId: string,
    endpoint: string,
    background: boolean,
    retryAfterSeconds: number | undefined,
  ): void {
    this.consecutiveRateLimits += 1;
    const backoff = SELLERWIX_CATALOG_BACKOFF;
    const pauseMs =
      retryAfterSeconds !== undefined
        ? Math.min(retryAfterSeconds * 1000, backoff.retryAfterMaxMs)
        : Math.round(
            Math.min(backoff.baseMs * 2 ** (this.consecutiveRateLimits - 1), backoff.maxMs) *
              (1 + Math.random() * backoff.jitterRatio),
          );
    this.backgroundPausedUntil = Math.max(this.backgroundPausedUntil, Date.now() + pauseMs);
    this.logger.warn({
      module: 'fulfillment',
      provider: 'SELLERWIX',
      event: background ? 'CATALOG_RATE_LIMITED' : 'FULFILLMENT_RATE_LIMITED',
      accountId,
      operation: endpoint,
      consecutiveRateLimits: this.consecutiveRateLimits,
      retryAfterSeconds: retryAfterSeconds ?? null,
      catalogPausedForMs: pauseMs,
      msg: 'Sellerwix trả 429 — dừng đồng bộ danh mục để chừa hạn mức cho Fulfillment',
    });
  }

  private withQuery(path: string, query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /** Khoảng giãn của nhóm — riêng `catalog` cấu hình được (không bao giờ nhỏ hơn trần toàn API). */
  private intervalOf(bucket: ThrottleBucket): number {
    if (bucket !== 'catalog') return SELLERWIX_MIN_INTERVAL_MS[bucket];
    const configured = Number(
      this.config.get<number>(SELLERWIX_CATALOG_MIN_INTERVAL_CONFIG_KEY, SELLERWIX_MIN_INTERVAL_MS.catalog),
    );
    return Number.isFinite(configured)
      ? Math.max(configured, SELLERWIX_MIN_INTERVAL_MS.global)
      : SELLERWIX_MIN_INTERVAL_MS.catalog;
  }

  /**
   * Giãn cách theo nhóm. Cộng dồn mốc thay vì ngủ cố định để lời gọi song song mỗi cái nhận một
   * khe riêng. Bộ đếm là của TIẾN TRÌNH: trần tần suất nằm ở phía nhà cung cấp.
   */
  private async throttle(bucket: ThrottleBucket): Promise<void> {
    const interval = this.intervalOf(bucket);
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

/** `Retry-After`: số giây hoặc HTTP-date (RFC 9110). Không có / sai dạng ⇒ `undefined`. */
export function parseRetryAfterSeconds(value: string | null, now: number = Date.now()): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}
