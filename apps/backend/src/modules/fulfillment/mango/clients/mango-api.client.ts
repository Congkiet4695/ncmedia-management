import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../../exceptions/fulfillment.exceptions';
import {
  MANGO_API_KEY_HEADER,
  MANGO_DEFAULT_BASE_URL,
  MANGO_ENDPOINTS,
  MANGO_ERROR_CODES,
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
 *  - Dịch lỗi HTTP + `code` của Mango thành `FulfillmentClientError` đã PHÂN LOẠI,
 *    nhờ vậy tầng service quyết định retry mà không cần biết chi tiết giao thức.
 *  - Đo thời lượng mỗi lần gọi (yêu cầu logging).
 *
 * 🔴 KHÔNG ghi API key vào log dưới bất kỳ hình thức nào.
 */
@Injectable()
export class MangoApiClient {
  private readonly logger = new Logger(MangoApiClient.name);

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
    return this.call<MangoCancelOrderData>(
      ctx,
      'POST',
      MANGO_ENDPOINTS.cancelOrder(orderId),
      body,
    );
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

  private withQuery(
    path: string,
    query: Record<string, string | number | undefined>,
  ): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /** Thực hiện một lời gọi có xác thực và bóc envelope. */
  private async call<T>(
    ctx: MangoCallContext,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<MangoResult<T>> {
    const baseUrl =
      ctx.baseUrl ||
      this.config.get<string>('fulfillment.mango.baseUrl', MANGO_DEFAULT_BASE_URL);
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
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));

    this.logger.log({
      module: 'fulfillment',
      provider: 'MANGOTEE',
      operation: `${method} ${path}`,
      httpStatus: response.status,
      requestId,
      durationMs,
      msg: 'Gọi MangoTeePrints API',
    });

    // Mango có thể trả HTTP 200 nhưng `status = false` ⇒ phải kiểm tra CẢ HAI.
    if (!response.ok || envelope?.status === false) {
      throw this.toClientError(response.status, envelope, rawText, `${method} ${path}`);
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
    );
  }
}
