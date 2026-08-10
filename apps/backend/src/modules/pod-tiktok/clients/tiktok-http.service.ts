import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RETRYABLE_ERROR_CLASSES,
  TiktokErrorClass,
  classifyTiktokError,
} from '../constants/tiktok-error-code.constants';
import { TIKTOK_SUCCESS_CODE } from '../constants/tiktok.constants';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { TiktokApiEnvelope } from '../types/tiktok-api.types';

/** Một lần gọi HTTP tới TikTok (đã dựng URL + header đầy đủ). */
export interface TiktokHttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  /** Body ĐÃ serialize — đúng chuỗi đã dùng để ký. */
  bodyJson?: string;
  /** Nhãn endpoint để log/metric (vd `GET_AUTHORIZED_SHOPS`). */
  endpoint: string;
}

/**
 * TiktokHttpService — tầng vận chuyển dùng chung cho MỌI lời gọi TikTok.
 *
 * Trách nhiệm:
 *  - Timeout theo cấu hình (AbortController).
 *  - Phân lớp lỗi 8 nhóm và CHỈ retry nhóm an toàn (network / rate limit / server 5xx),
 *    đúng khuyến nghị chính thức: "Apply the right response to each class instead of
 *    using one retry policy for everything".
 *  - Exponential backoff + jitter + honor `Retry-After`
 *    (công thức chính thức: wait = max(retry_after, min(base * 2^n + jitter, cap))).
 *  - Log `request_id` của TikTok ở mọi lỗi — bắt buộc khi mở ticket hỗ trợ.
 *  - KHÔNG log token/app_secret/sign.
 *
 * ⚠️ Đây là cửa duy nhất ra internet của module — không service nào được tự `fetch`.
 */
@Injectable()
export class TiktokHttpService {
  private readonly logger = new Logger(TiktokHttpService.name);

  private static readonly BASE_DELAY_MS = 1_000;
  private static readonly MAX_DELAY_MS = 60_000;
  private static readonly MAX_JITTER_MS = 500;

  private readonly timeoutMs: number;
  private readonly maxRetry: number;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>('tiktok.httpTimeoutMs', 15_000);
    this.maxRetry = config.get<number>('tiktok.maxRetry', 3);
  }

  /**
   * Gọi TikTok API và trả về `data` khi `code === 0`.
   * Mọi trường hợp khác ném `TiktokClientError` đã phân lớp.
   */
  async request<T>(req: TiktokHttpRequest): Promise<{ data: T; requestId?: string }> {
    let lastError: TiktokClientError | undefined;

    for (let attempt = 0; attempt <= this.maxRetry; attempt++) {
      if (attempt > 0) {
        await this.delay(this.computeBackoff(attempt - 1, lastError?.retryAfterSeconds));
      }

      try {
        return await this.executeOnce<T>(req, attempt);
      } catch (error) {
        if (!(error instanceof TiktokClientError)) throw error;
        lastError = error;

        const retryable = RETRYABLE_ERROR_CLASSES.includes(error.errorClass);
        this.logError(req, error, attempt, retryable && attempt < this.maxRetry);
        if (!retryable || attempt === this.maxRetry) throw error;
      }
    }

    // Không thể tới đây (vòng lặp luôn return hoặc throw) — giữ để thoả TypeScript.
    throw lastError ?? new Error('TikTok request failed');
  }

  /** Một lần gọi HTTP, không retry. */
  private async executeOnce<T>(
    req: TiktokHttpRequest,
    attempt: number,
  ): Promise<{ data: T; requestId?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.bodyJson,
        signal: controller.signal,
      });
    } catch (error) {
      // Lỗi tầng transport: abort (timeout), DNS, TLS, ECONNRESET...
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new TiktokClientError(
        TiktokErrorClass.NETWORK,
        0,
        aborted ? 'Request timeout' : (error as Error).message,
        0,
        undefined,
        req.endpoint,
      );
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    const retryAfter = this.parseRetryAfter(response.headers.get('retry-after'));

    let envelope: TiktokApiEnvelope<T>;
    try {
      envelope = (await response.json()) as TiktokApiEnvelope<T>;
    } catch {
      throw this.buildError(
        response.status,
        0,
        'Phản hồi TikTok không phải JSON hợp lệ',
        undefined,
        req.endpoint,
        retryAfter,
      );
    }

    if (!response.ok || envelope.code !== TIKTOK_SUCCESS_CODE) {
      throw this.buildError(
        response.status,
        envelope.code ?? 0,
        envelope.message ?? 'Unknown error',
        envelope.request_id,
        req.endpoint,
        retryAfter,
      );
    }

    this.logger.log({
      module: 'pod-tiktok',
      endpoint: req.endpoint,
      httpStatus: response.status,
      tiktokCode: envelope.code,
      tiktokRequestId: envelope.request_id,
      durationMs,
      attempt,
      msg: 'TikTok API call succeeded',
    });

    return { data: envelope.data as T, requestId: envelope.request_id };
  }

  private buildError(
    httpStatus: number,
    code: number,
    message: string,
    requestId: string | undefined,
    endpoint: string,
    retryAfterSeconds?: number,
  ): TiktokClientError {
    const error = new TiktokClientError(
      classifyTiktokError(httpStatus, code, message),
      code,
      message,
      httpStatus,
      requestId,
      endpoint,
    );
    error.retryAfterSeconds = retryAfterSeconds;
    return error;
  }

  private logError(
    req: TiktokHttpRequest,
    error: TiktokClientError,
    attempt: number,
    willRetry: boolean,
  ): void {
    const payload = {
      module: 'pod-tiktok',
      endpoint: req.endpoint,
      httpStatus: error.httpStatus,
      tiktokCode: error.tiktokCode,
      // `request_id` — TikTok Support yêu cầu giá trị này khi mở ticket.
      tiktokRequestId: error.requestId,
      errorClass: error.errorClass,
      attempt,
      willRetry,
      msg: error.tiktokMessage,
    };
    // Lỗi lập trình/cấu hình cần chú ý ngay; còn lại là cảnh báo vận hành.
    if (
      error.errorClass === TiktokErrorClass.CLIENT_BUG ||
      error.errorClass === TiktokErrorClass.CONFIG
    ) {
      this.logger.error(payload);
    } else {
      this.logger.warn(payload);
    }
  }

  /**
   * wait = max(retry_after, min(base * 2^attempt + jitter, cap)) — công thức chính thức.
   * Jitter chống "thundering herd" khi chạy nhiều instance.
   */
  private computeBackoff(attempt: number, retryAfterSeconds?: number): number {
    const generated = Math.min(
      TiktokHttpService.BASE_DELAY_MS * 2 ** attempt + Math.random() * TiktokHttpService.MAX_JITTER_MS,
      TiktokHttpService.MAX_DELAY_MS,
    );
    const header = retryAfterSeconds !== undefined ? retryAfterSeconds * 1_000 : undefined;
    return header !== undefined ? Math.max(generated, header) : generated;
  }

  /** `Retry-After` có thể là số giây hoặc HTTP-date (theo tài liệu Rate limits). */
  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds);
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1_000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
