import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  NotificationEventQuery,
  NotificationPreferences,
  PaginatedNotificationEvents,
  SaveTelegramConfigInput,
  TelegramConfig,
  TelegramTestResult,
  TestTelegramInput,
} from '../types';

const BASE_PATH = '/notifications';

/**
 * API cấu hình thông báo Telegram của TỔ CHỨC hiện tại (tổ chức lấy từ JWT phía backend —
 * giao diện không gửi id tổ chức nào).
 */
export const notificationService = {
  async getPreferences(): Promise<NotificationPreferences> {
    const res = await apiClient.get<ApiResponse<NotificationPreferences>>(`${BASE_PATH}/preferences`);
    return res.data.data;
  },

  async savePreferences(input: NotificationPreferences): Promise<NotificationPreferences> {
    const res = await apiClient.put<ApiResponse<NotificationPreferences>>(`${BASE_PATH}/preferences`, input);
    return res.data.data;
  },

  async getTelegram(): Promise<TelegramConfig> {
    const res = await apiClient.get<ApiResponse<TelegramConfig>>(`${BASE_PATH}/telegram`);
    return res.data.data;
  },

  async saveTelegram(input: SaveTelegramConfigInput): Promise<TelegramConfig> {
    const res = await apiClient.put<ApiResponse<TelegramConfig>>(`${BASE_PATH}/telegram`, input);
    return res.data.data;
  },

  async removeTelegram(): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/telegram`);
  },

  async testTelegram(input: TestTelegramInput): Promise<TelegramTestResult> {
    const res = await apiClient.post<ApiResponse<TelegramTestResult>>(
      `${BASE_PATH}/telegram/test`,
      input,
    );
    return res.data.data;
  },

  async listEvents(query: NotificationEventQuery): Promise<PaginatedNotificationEvents> {
    const res = await apiClient.get<ApiResponse<PaginatedNotificationEvents>>(
      `${BASE_PATH}/events`,
      { params: query },
    );
    return res.data.data;
  },

  async retryEvent(id: string): Promise<void> {
    await apiClient.post(`${BASE_PATH}/events/${id}/retry`);
  },

  async retryFailed(): Promise<{ requeued: number }> {
    const res = await apiClient.post<ApiResponse<{ requeued: number }>>(
      `${BASE_PATH}/events/retry-failed`,
    );
    return res.data.data;
  },
};
