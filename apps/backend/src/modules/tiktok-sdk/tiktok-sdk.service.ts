import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientConfiguration, TikTokShopNodeApiClient } from '@tiktok-shop/nodejs-sdk';
import {
  RETRYABLE_ERROR_CLASSES,
  TiktokErrorClass,
  classifyTiktokError,
} from '../pod-tiktok/constants/tiktok-error-code.constants';
import { TIKTOK_SUCCESS_CODE } from '../pod-tiktok/constants/tiktok.constants';
import { TiktokClientError } from '../pod-tiktok/exceptions/pod-tiktok.exceptions';
import {
  TIKTOK_SDK_BASE_DELAY_MS,
  TIKTOK_SDK_MAX_DELAY_MS,
  TIKTOK_SDK_MAX_JITTER_MS,
  TIKTOK_SDK_MAX_RETRY,
} from './tiktok-sdk.constants';
import type { TiktokSdkResult } from './types/tiktok-shop-context.type';

/** Envelope chuẩn của mọi response TikTok — SDK sinh ra đúng shape này cho mọi endpoint. */
interface TiktokSdkEnvelope<T> {
  code?: number;
  message?: string;
  requestId?: string;
  data?: T;
}

/** Một lời gọi SDK đã được đóng gói để `execute` chạy lại được khi cần retry. */
export interface TiktokSdkCall<T> {
  /** Nhãn để log/metric, vd `PRODUCT_SEARCH`. KHÔNG phải path. */
  endpoint: string;
  /** Hàm thực sự gọi SDK — trả về `{ body }` như SDK quy định. */
  invoke: () => Promise<{ body: TiktokSdkEnvelope<T> }>;
}

/**
 * TikTokSdkService — **cửa duy nhất** ra SDK TikTok của toàn hệ thống.
 *
 * 🔴 Quy tắc kiến trúc (yêu cầu Sprint 1):
 *  - Không module nào ngoài `tiktok-sdk/` được `import` gói SDK.
 *  - Không gọi HTTP thẳng tới TikTok khi SDK đã có endpoint tương ứng.
 *  - SDK đổi (đổi tên lớp, đổi version, đổi cách khởi tạo) ⇒ chỉ sửa trong thư mục này.
 *
 * Việc service này làm ngoài "gọi hộ":
 *  - Khởi tạo client MỘT lần với `app_key`/`app_secret` từ ConfigService (SDK tự ký HMAC,
 *    tự gắn `timestamp` + `app_key` — không tự viết lại phần ký).
 *  - Bóc envelope `{code,message,data,request_id}`: `code !== 0` ⇒ ném `TiktokClientError`
 *    đã PHÂN LỚP, dùng chung bảng lỗi với module POD (một nguồn sự thật cho mã lỗi TikTok).
 *  - Retry + backoff + jitter đúng công thức chính thức, CHỈ cho nhóm lỗi tạm thời.
 *  - Log `request_id` ở mọi lỗi (TikTok Support luôn hỏi), KHÔNG log token.
 */
@Injectable()
export class TikTokSdkService implements OnModuleInit {
  private readonly logger = new Logger(TikTokSdkService.name);
  private client?: TikTokShopNodeApiClient;

  constructor(private readonly config: ConfigService) {}

  /**
   * Khởi tạo client khi module lên.
   *
   * `ClientConfiguration.globalConfig` là biến TĨNH của SDK; đặt một lần ở đây thay vì
   * rải rác trong service nghiệp vụ. Base URL lấy từ cấu hình `tiktok.apiBaseUrl` đang có
   * để môi trường sandbox/production dùng chung một đường cấu hình.
   */
  onModuleInit(): void {
    const appKey = this.config.getOrThrow<string>('tiktok.appKey');
    const appSecret = this.config.getOrThrow<string>('tiktok.appSecret');
    const basePath = this.config.get<string>('tiktok.apiBaseUrl');

    ClientConfiguration.globalConfig.app_key = appKey;
    ClientConfiguration.globalConfig.app_secret = appSecret;

    this.client = new TikTokShopNodeApiClient({
      config: new ClientConfiguration(appKey, appSecret, basePath),
    });

    this.logger.log({
      module: 'tiktok-sdk',
      operation: 'sdk.init',
      basePath: basePath ?? '(mặc định của SDK)',
      msg: 'Đã khởi tạo TikTok Shop Node SDK client',
    });
  }

  /**
   * Truy cập nhóm API của SDK.
   *
   * ⚠️ `internal` theo quy ước: CHỈ các wrapper trong thư mục `tiktok-sdk/` được gọi.
   * Trả về `api` map do SDK sinh (`ProductV202502Api`, `ProductV202309Api`, …).
   */
  get api(): TikTokShopNodeApiClient['api'] {
    if (!this.client) {
      // Xảy ra khi ai đó gọi trước `onModuleInit` (vd trong constructor của service khác).
      throw new Error('TikTokSdkService chưa khởi tạo — không được gọi API ở constructor');
    }
    return this.client.api;
  }

  /**
   * Thực thi một lời gọi SDK: retry nhóm lỗi tạm thời → bóc envelope → trả `data` + `requestId`.
   *
   * Ném `TiktokClientError` (đã phân lớp) cho mọi trường hợp thất bại, để tầng nghiệp vụ
   * dịch sang exception người dùng đọc được — giống hệt cách module POD đang làm.
   */
  async execute<T>(call: TiktokSdkCall<T>): Promise<TiktokSdkResult<T>> {
    let lastError: TiktokClientError | undefined;

    for (let attempt = 0; attempt <= TIKTOK_SDK_MAX_RETRY; attempt++) {
      if (attempt > 0) {
        await this.delay(this.computeBackoff(attempt - 1, lastError?.retryAfterSeconds));
      }

      try {
        return await this.executeOnce<T>(call);
      } catch (error) {
        if (!(error instanceof TiktokClientError)) throw error;
        lastError = error;

        const retryable = RETRYABLE_ERROR_CLASSES.includes(error.errorClass);
        this.logger.error({
          module: 'tiktok-sdk',
          endpoint: call.endpoint,
          attempt,
          tiktokCode: error.tiktokCode,
          tiktokRequestId: error.requestId,
          errorClass: error.errorClass,
          willRetry: retryable && attempt < TIKTOK_SDK_MAX_RETRY,
          msg: error.tiktokMessage,
        });
        if (!retryable || attempt === TIKTOK_SDK_MAX_RETRY) throw error;
      }
    }

    // Không thể tới đây (vòng lặp luôn return hoặc throw) — giữ để thoả TypeScript.
    throw lastError ?? new Error(`TikTok SDK call failed: ${call.endpoint}`);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async executeOnce<T>(call: TiktokSdkCall<T>): Promise<TiktokSdkResult<T>> {
    let body: TiktokSdkEnvelope<T>;

    try {
      ({ body } = await call.invoke());
    } catch (error) {
      // Lỗi tầng vận chuyển (DNS, timeout, socket) hoặc HTTP status ≠ 2xx do SDK ném ra.
      throw this.toTransportError(error, call.endpoint);
    }

    const code = body?.code ?? TIKTOK_SUCCESS_CODE;
    if (code !== TIKTOK_SUCCESS_CODE) {
      const message = body?.message ?? 'TikTok trả về mã lỗi';
      throw new TiktokClientError(
        // HTTP vẫn 200 khi TikTok báo lỗi nghiệp vụ — phân lớp dựa vào `code` + message.
        classifyTiktokError(200, code, message),
        code,
        message,
        200,
        body?.requestId,
        call.endpoint,
      );
    }

    return { data: (body?.data ?? {}) as T, requestId: body?.requestId };
  }

  /**
   * Chuẩn hoá lỗi do SDK/HTTP ném ra thành `TiktokClientError`.
   *
   * SDK dùng thư viện `request`: lỗi mạng là `Error` thường, còn HTTP ≠ 2xx là `HttpError`
   * mang `statusCode` + `body`. Đọc cả hai dạng để không mất mã lỗi nghiệp vụ khi TikTok
   * trả 4xx/5xx kèm envelope.
   */
  private toTransportError(error: unknown, endpoint: string): TiktokClientError {
    const raw = error as { statusCode?: number; body?: TiktokSdkEnvelope<unknown>; message?: string };
    const httpStatus = typeof raw?.statusCode === 'number' ? raw.statusCode : 0;
    const tiktokCode = raw?.body?.code ?? 0;
    const message = raw?.body?.message ?? raw?.message ?? 'TikTok SDK request failed';

    const errorClass =
      httpStatus === 0
        ? TiktokErrorClass.NETWORK
        : classifyTiktokError(httpStatus, tiktokCode, message);

    return new TiktokClientError(
      errorClass,
      tiktokCode,
      message,
      httpStatus,
      raw?.body?.requestId,
      endpoint,
    );
  }

  /** wait = max(retry_after, min(base · 2^n + jitter, cap)) — công thức chính thức. */
  private computeBackoff(retryCount: number, retryAfterSeconds?: number): number {
    const exponential = Math.min(
      TIKTOK_SDK_BASE_DELAY_MS * Math.pow(2, retryCount) +
        Math.floor(Math.random() * TIKTOK_SDK_MAX_JITTER_MS),
      TIKTOK_SDK_MAX_DELAY_MS,
    );
    return Math.max((retryAfterSeconds ?? 0) * 1000, exponential);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
