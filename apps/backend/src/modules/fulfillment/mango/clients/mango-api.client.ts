import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import { MANGO_RATE_LIMIT_PER_SECOND } from '../constants/mango.constants';
import {
  MANGO_API_KEY_HEADER,
  MANGO_DEFAULT_BASE_URL,
  MANGO_ENDPOINTS,
  MANGO_ERROR_CODES,
  MANGO_RATE_LIMIT_HEADERS,
  MANGO_RETRY,
} from '../constants/mango.constants';
import {
  MangoCancelOrderData,
  MangoCancelOrderRequest,
  MangoCreateOrderData,
  MangoCreateOrderRequest,
  MangoEnvelope,
  MangoErrorData,
  MangoOrderResponse,
  MangoProductionLinesData,
  MangoProductsData,
  MangoVariationsData,
  MangoWebhookCreateRequest,
  MangoWebhookData,
} from '../types/mango-api.types';

/** Ngữ cảnh xác thực cho mỗi lần gọi — API key lấy từ tài khoản đã giải mã. */
export interface MangoCallContext {
  apiKey: string;
  /** Ghi đè base URL (môi trường thử nghiệm). Bỏ trống ⇒ dùng cấu hình hệ thống. */
  baseUrl?: string | null;
}

/** Kết quả một lần gọi, kèm metadata phục vụ log/đối soát. */
export interface MangoResult<T> {
  data: T;
  requestId?: string;
  durationMs: number;
  /** Số request còn lại trong cửa sổ giới hạn (nếu Mango trả header). */
  rateLimitRemaining?: number;
}

/**
 * MangoApiClient — cửa DUY NHẤT ra MangoTeePrints (MangoV3 Public API).
 *
 * Trách nhiệm:
 *  - Gắn header `X-API-Key` và `content-type`.
 *  - Bóc envelope chuẩn `{status, code, message, data, request_id}`.
 *  - Dịch lỗi HTTP + `code` của Mango thành `FulfillmentClientError` đã PHÂN LOẠI.
 *  - **Thử lại** những lỗi tạm thời, và **tự điều tiết tần suất** (xem dưới).
 *  - Đo thời lượng mỗi lần gọi (yêu cầu logging).
 *
 * 🔴 **Retry.** Chỉ thử lại lớp lỗi TẠM THỜI (`RATE_LIMIT` / `NETWORK` / `SERVER` — danh sách
 * ở `RETRYABLE_ERROR_CLASSES`, một nguồn sự thật duy nhất). Lỗi `AUTH` / `VALIDATION` /
 * `NOT_FOUND` KHÔNG thử lại: chúng sẽ hỏng y hệt ở lần thứ hai, thử lại chỉ làm người dùng
 * chờ lâu gấp ba.
 *
 * 🔴 **Chỉ GET được thử lại tự động.** POST tạo đơn KHÔNG bao giờ tự thử lại ở tầng này: một
 * request timeout có thể đã tới nơi và đơn đã được tạo, thử lại là sản xuất trùng — hàng
 * thật, tiền thật. Luồng tạo đơn có cơ chế retry riêng ở tầng service, đi cùng `externalOrderId`
 * duy nhất để nhà cung cấp tự chặn trùng.
 *
 * 🔴 **Điều tiết tần suất.** Mango giới hạn 10 request/giây. Đồng bộ danh mục gọi hàng nghìn
 * lần liên tiếp nên chắc chắn chạm trần nếu không tự giãn. Client giữ khoảng cách tối thiểu
 * giữa hai request (`MANGO_RATE_LIMIT_PER_SECOND`) và tôn trọng header `x-ratelimit-reset`
 * khi bị từ chối. Hàng đợi là TOÀN CỤC cho tiến trình: giới hạn nằm ở phía nhà cung cấp, nên
 * chia theo tài khoản sẽ vẫn vượt trần khi hai tài khoản chạy cùng lúc.
 *
 * 🔴 KHÔNG ghi API key vào log dưới bất kỳ hình thức nào.
 */
@Injectable()
export class MangoApiClient {
  private readonly logger = new Logger(MangoApiClient.name);

  /**
   * Mốc thời gian sớm nhất được phép gửi request kế tiếp.
   *
   * Một biến duy nhất thay cho một hàng đợi đầy đủ: mọi lời gọi đều đi qua `throttle()` và
   * đẩy mốc này lên, nên các lời gọi song song tự xếp hàng theo đúng thứ tự chạm vào nó.
   */
  private nextSlotAt = 0;

  constructor(private readonly config: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  createOrder(
    ctx: MangoCallContext,
    body: MangoCreateOrderRequest,
  ): Promise<MangoResult<MangoCreateOrderData>> {
    return this.call<MangoCreateOrderData>(ctx, 'POST', MANGO_ENDPOINTS.createOrder, body);
  }

  getOrder(ctx: MangoCallContext, orderId: string): Promise<MangoResult<MangoOrderResponse>> {
    return this.call<MangoOrderResponse>(ctx, 'GET', MANGO_ENDPOINTS.orderDetail(orderId));
  }

  cancelOrder(
    ctx: MangoCallContext,
    orderId: string,
    body: MangoCancelOrderRequest,
  ): Promise<MangoResult<MangoCancelOrderData>> {
    return this.call<MangoCancelOrderData>(ctx, 'POST', MANGO_ENDPOINTS.cancelOrder(orderId), body);
  }

  // ---------------------------------------------------------------------------
  // Catalog — phục vụ màn hình khai báo ánh xạ sản phẩm
  // ---------------------------------------------------------------------------

  listProducts(
    ctx: MangoCallContext,
    query: { page?: number; limit?: number; name?: string; catalog_id?: string } = {},
  ): Promise<MangoResult<MangoProductsData>> {
    return this.call<MangoProductsData>(
      ctx,
      'GET',
      this.withQuery(MANGO_ENDPOINTS.products, query),
    );
  }

  listVariations(
    ctx: MangoCallContext,
    productId: string,
    query: { page?: number; limit?: number; color?: string; size?: string } = {},
  ): Promise<MangoResult<MangoVariationsData>> {
    return this.call<MangoVariationsData>(
      ctx,
      'GET',
      this.withQuery(MANGO_ENDPOINTS.productVariations(productId), query),
    );
  }

  listProductionLines(ctx: MangoCallContext): Promise<MangoResult<MangoProductionLinesData>> {
    return this.call<MangoProductionLinesData>(ctx, 'GET', MANGO_ENDPOINTS.productionLines);
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  createWebhook(
    ctx: MangoCallContext,
    body: MangoWebhookCreateRequest,
  ): Promise<MangoResult<MangoWebhookData>> {
    return this.call<MangoWebhookData>(ctx, 'POST', MANGO_ENDPOINTS.webhooks, body);
  }

  listWebhooks(ctx: MangoCallContext): Promise<MangoResult<unknown>> {
    return this.call<unknown>(ctx, 'GET', MANGO_ENDPOINTS.webhooks);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private withQuery(path: string, query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /**
   * Thực hiện một lời gọi có xác thực, có điều tiết tần suất và có thử lại.
   *
   * Chỉ `GET` được thử lại tự động — xem chú thích ở đầu lớp về lý do POST không được.
   */
  private async call<T>(
    ctx: MangoCallContext,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<MangoResult<T>> {
    const maxAttempts = method === 'GET' ? MANGO_RETRY.maxAttempts : 1;

    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.throttle();
        return await this.callOnce<T>(ctx, method, path, body);
      } catch (error) {
        const clientError = error instanceof FulfillmentClientError ? error : undefined;

        if (!clientError?.retryable || attempt >= maxAttempts) throw error;

        const delayMs = this.retryDelayMs(attempt, clientError);
        this.logger.warn({
          module: 'fulfillment',
          provider: 'MANGO',
          operation: `${method} ${path}`,
          attempt,
          maxAttempts,
          errorClass: clientError.errorClass,
          httpStatus: clientError.httpStatus,
          requestId: clientError.requestId,
          delayMs,
          msg: `Lỗi tạm thời, thử lại lần ${attempt + 1}/${maxAttempts} sau ${delayMs}ms: ${clientError.message}`,
        });
        await this.sleep(delayMs);
      }
    }
  }

  /**
   * Giãn cách giữa hai request để không vượt trần 10 req/s của nhà cung cấp.
   *
   * Cộng dồn vào `nextSlotAt` thay vì "ngủ một khoảng cố định": khi có nhiều lời gọi song
   * song, mỗi lời gọi nhận một khe riêng và tổng tần suất vẫn đúng trần. Ngủ cố định sẽ cho
   * N lời gọi song song cùng bắn đi một lúc.
   */
  private async throttle(): Promise<void> {
    const minIntervalMs = Math.ceil(1000 / MANGO_RATE_LIMIT_PER_SECOND);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + minIntervalMs;
    if (slot > now) await this.sleep(slot - now);
  }

  /**
   * Khoảng chờ trước lần thử kế tiếp: lùi theo cấp số nhân + nhiễu ngẫu nhiên.
   *
   * Nhiễu (jitter) là bắt buộc chứ không phải trang trí: nhiều tiến trình cùng bị 429 sẽ
   * cùng thức dậy đúng một thời điểm và lại cùng bị 429 nếu chờ đúng bằng nhau.
   * Khi nhà cung cấp nói rõ `x-ratelimit-reset`, con số của họ được ưu tiên.
   */
  private retryDelayMs(attempt: number, error: FulfillmentClientError): number {
    if (error.errorClass === FulfillmentErrorClass.RATE_LIMIT && error.rateLimitResetSeconds) {
      return Math.min(error.rateLimitResetSeconds * 1000, MANGO_RETRY.maxDelayMs);
    }
    const backoff = MANGO_RETRY.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * MANGO_RETRY.jitterMs);
    return Math.min(backoff + jitter, MANGO_RETRY.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** MỘT lần gọi thật — không thử lại, không điều tiết. */
  private async callOnce<T>(
    ctx: MangoCallContext,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<MangoResult<T>> {
    const baseUrl =
      ctx.baseUrl || this.config.get<string>('fulfillment.mango.baseUrl', MANGO_DEFAULT_BASE_URL);
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    const timeoutMs = this.config.get<number>('fulfillment.mango.timeoutMs', 30_000);

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          [MANGO_API_KEY_HEADER]: ctx.apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = (error as Error).name === 'AbortError';
      throw new FulfillmentClientError(
        FulfillmentErrorClass.NETWORK,
        aborted
          ? `Hết thời gian chờ sau ${timeoutMs}ms`
          : `Lỗi mạng khi gọi nhà cung cấp: ${(error as Error).message}`,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        `${method} ${path}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    const rawText = await response.text();
    const envelope = this.parseJson(rawText);
    const requestId = envelope?.request_id;
    const remaining = Number(response.headers.get(MANGO_RATE_LIMIT_HEADERS.remaining));
    const resetSeconds = Number(response.headers.get(MANGO_RATE_LIMIT_HEADERS.reset));

    this.logger.log({
      module: 'fulfillment',
      provider: 'MANGO',
      operation: `${method} ${path}`,
      httpStatus: response.status,
      requestId,
      durationMs,
      msg: 'Gọi MangoTeePrints API',
    });

    // Mango có thể trả HTTP 200 nhưng `status = false` ⇒ phải kiểm tra CẢ HAI.
    if (!response.ok || envelope?.status === false) {
      throw this.toClientError(
        response.status,
        envelope,
        rawText,
        `${method} ${path}`,
        Number.isFinite(resetSeconds) ? resetSeconds : undefined,
      );
    }

    return {
      data: (envelope?.data ?? null) as T,
      requestId,
      durationMs,
      rateLimitRemaining: Number.isFinite(remaining) ? remaining : undefined,
    };
  }

  private parseJson(text: string): MangoEnvelope<unknown> | null {
    if (!text) return null;
    try {
      return JSON.parse(text) as MangoEnvelope<unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Dịch lỗi sang lớp đã phân loại.
   *
   * Ưu tiên `code` trong envelope (chính xác hơn), sau đó mới suy từ HTTP status —
   * vì Mango có thể trả 200 kèm `status = false` cho lỗi nghiệp vụ.
   */
  private toClientError(
    httpStatus: number,
    envelope: MangoEnvelope<unknown> | null,
    rawText: string,
    endpoint: string,
    /** `x-ratelimit-reset` — số giây tới khi cửa sổ giới hạn mở lại. */
    rateLimitResetSeconds?: number,
  ): FulfillmentClientError {
    const code = envelope?.code;
    const message =
      envelope?.message || `Nhà cung cấp trả về HTTP ${httpStatus}` || 'Lỗi không xác định';
    const validationErrors = (envelope?.data as MangoErrorData | undefined)?.errors;

    let errorClass = FulfillmentErrorClass.UNKNOWN;
    switch (code) {
      case MANGO_ERROR_CODES.UNAUTHORIZED:
      case MANGO_ERROR_CODES.FORBIDDEN:
        errorClass = FulfillmentErrorClass.AUTH;
        break;
      case MANGO_ERROR_CODES.VALIDATION_ERROR:
        errorClass = FulfillmentErrorClass.VALIDATION;
        break;
      case MANGO_ERROR_CODES.NOT_FOUND:
        errorClass = FulfillmentErrorClass.NOT_FOUND;
        break;
      case MANGO_ERROR_CODES.RATE_LIMIT_EXCEEDED:
        errorClass = FulfillmentErrorClass.RATE_LIMIT;
        break;
      case MANGO_ERROR_CODES.INTERNAL_ERROR:
        errorClass = FulfillmentErrorClass.SERVER;
        break;
      default:
        if (httpStatus === 401 || httpStatus === 403) errorClass = FulfillmentErrorClass.AUTH;
        else if (httpStatus === 404) errorClass = FulfillmentErrorClass.NOT_FOUND;
        else if (httpStatus === 422 || httpStatus === 400) {
          errorClass = FulfillmentErrorClass.VALIDATION;
        } else if (httpStatus === 429) errorClass = FulfillmentErrorClass.RATE_LIMIT;
        else if (httpStatus >= 500) errorClass = FulfillmentErrorClass.SERVER;
    }

    return new FulfillmentClientError(
      errorClass,
      message,
      httpStatus,
      code,
      validationErrors,
      envelope?.request_id,
      // Giữ nguyên body để điều tra; cắt bớt để không phình bảng log.
      envelope ?? String(rawText).slice(0, 4000),
      endpoint,
      rateLimitResetSeconds,
    );
  }
}
