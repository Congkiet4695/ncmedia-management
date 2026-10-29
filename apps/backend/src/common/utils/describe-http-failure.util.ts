import { HttpException } from '@nestjs/common';

/** Lỗi của MỘT dòng trong thao tác hàng loạt — đúng hình dạng `{ code, message }` của Error Response. */
export interface RowFailure {
  code: string;
  message: string;
}

export interface DescribeFailureOptions {
  /**
   * `true` ⇒ lỗi KHÔNG phải `HttpException` vẫn trả nguyên `error.message` (vd lỗi do sàn trả về mà người
   * vận hành cần đọc để xử lý). Mặc định `false`: lỗi hạ tầng / Prisma không lộ chi tiết ra response.
   */
  exposeErrorMessage?: boolean;
}

/**
 * Lỗi bất kỳ ⇒ `{ code, message }` cho kết quả theo TỪNG dòng của thao tác hàng loạt.
 *
 * `HttpException` (exception chuẩn của module) giữ nguyên mã + thông điệp nghiệp vụ. Lỗi khác trả
 * `fallbackCode` kèm `fallbackMessage` (hoặc `error.message` khi `exposeErrorMessage`).
 */
export function describeHttpFailure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  options: DescribeFailureOptions = {},
): RowFailure {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      return {
        code: typeof record.code === 'string' ? record.code : fallbackCode,
        message: typeof record.message === 'string' ? record.message : error.message,
      };
    }
    return { code: fallbackCode, message: error.message };
  }
  const exposed = options.exposeErrorMessage && error instanceof Error ? error.message : null;
  return { code: fallbackCode, message: exposed ?? fallbackMessage };
}
