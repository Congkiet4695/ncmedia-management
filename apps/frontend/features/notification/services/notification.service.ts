import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  NotificationChannelScope,
  NotificationEventQuery,
  NotificationPreferences,
  PaginatedNotificationEvents,
  SaveTelegramConfigInput,
  TelegramConfig,
  TelegramTestResult,
  TestTelegramInput,
} from '../types';

/**
 * Đường dẫn của từng kênh:
 *  - `organization` — kênh của TỔ CHỨC (quyền `notification.config`), nhận mọi đơn.
 *  - `me`           — kênh CÁ NHÂN của người đang đăng nhập (quyền `notification.self`), chỉ nhận đơn thuộc shop
 *                     được gán cho chính người đó (backend lọc — giao diện không gửi shop hay id người dùng nào).
 */
const BASE_PATH: Record<NotificationChannelScope, string> = {
  organization: '/notifications',
  me: '/notifications/me',
};

/**
 * API cấu hình thông báo Telegram của MỘT kênh. Tổ chức / người dùng lấy từ JWT phía backend — giao diện không gửi
 * id tổ chức hay id người dùng nào.
 */
export function notificationServiceFor(scope: NotificationChannelScope) {
  const base = BASE_PATH[scope];
  return {
    async getPreferences(): Promise<NotificationPreferences> {
      const res = await apiClient.get<ApiResponse<NotificationPreferences>>(`${base}/preferences`);
      return res.data.data;
    },

    async savePreferences(input: NotificationPreferences): Promise<NotificationPreferences> {
      const res = await apiClient.put<ApiResponse<NotificationPreferences>>(`${base}/preferences`, input);
      return res.data.data;
    },

    async getTelegram(): Promise<TelegramConfig> {
      const res = await apiClient.get<ApiResponse<TelegramConfig>>(`${base}/telegram`);
      return res.data.data;
    },

    async saveTelegram(input: SaveTelegramConfigInput): Promise<TelegramConfig> {
      const res = await apiClient.put<ApiResponse<TelegramConfig>>(`${base}/telegram`, input);
      return res.data.data;
    },

    async removeTelegram(): Promise<void> {
      await apiClient.delete(`${base}/telegram`);
    },

    async testTelegram(input: TestTelegramInput): Promise<TelegramTestResult> {
      const res = await apiClient.post<ApiResponse<TelegramTestResult>>(`${base}/telegram/test`, input);
      return res.data.data;
    },

    async listEvents(query: NotificationEventQuery): Promise<PaginatedNotificationEvents> {
      const res = await apiClient.get<ApiResponse<PaginatedNotificationEvents>>(`${base}/events`, {
        params: query,
      });
      return res.data.data;
    },

    async retryEvent(id: string): Promise<void> {
      await apiClient.post(`${base}/events/${id}/retry`);
    },

    async retryFailed(): Promise<{ requeued: number }> {
      const res = await apiClient.post<ApiResponse<{ requeued: number }>>(`${base}/events/retry-failed`);
      return res.data.data;
    },
  };
}

/** Kênh của tổ chức — giữ tên cũ cho nơi đang dùng. */
export const notificationService = notificationServiceFor('organization');
