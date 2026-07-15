import { AxiosError } from 'axios';
import type { ApiErrorResponse } from '@/types/api';

/**
 * Trích message lỗi thân thiện từ AxiosError / envelope lỗi của Backend (ADR-022).
 */
export function getApiErrorMessage(error: unknown, fallback = 'Đã có lỗi xảy ra'): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;
    if (data?.message) return data.message;
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Trích `code` nghiệp vụ từ envelope lỗi (vd AUTH_EMAIL_EXISTS, AUTH_INVALID_CREDENTIALS).
 */
export function getApiErrorCode(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;
    return data?.code;
  }
  return undefined;
}

/**
 * Trích danh sách lỗi theo field (để map vào React Hook Form).
 */
export function getApiFieldErrors(error: unknown): Record<string, string> {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorResponse | undefined;
    if (data?.errors?.length) {
      return data.errors.reduce<Record<string, string>>((acc, item) => {
        acc[item.field] = item.message;
        return acc;
      }, {});
    }
  }
  return {};
}
