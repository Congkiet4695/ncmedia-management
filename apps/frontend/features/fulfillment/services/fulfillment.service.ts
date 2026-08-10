import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  FulfillmentError,
  FulfillmentHistoryEntry,
  FulfillmentOrder,
  FulfillmentState,
} from '../types';

const BASE_PATH = '/fulfillment';

/**
 * API gửi đơn sang xưởng in.
 * Mọi kiểm tra điều kiện đều do BACKEND thực hiện — frontend chỉ hiển thị kết quả,
 * không tự đoán đơn nào gửi được để tránh lệch với luồng gửi thật.
 */
export const fulfillmentService = {
  /** Trạng thái + lý do chưa gửi được của một đơn POD. */
  async getState(podOrderId: string): Promise<FulfillmentState> {
    const res = await apiClient.get<ApiResponse<FulfillmentState>>(
      `${BASE_PATH}/orders/${podOrderId}`,
    );
    return res.data.data;
  },

  async fulfill(podOrderId: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/fulfill`,
    );
    return res.data.data;
  },

  async retry(podOrderId: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/retry`,
    );
    return res.data.data;
  },

  async sync(podOrderId: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/sync`,
    );
    return res.data.data;
  },

  async cancel(podOrderId: string, reason?: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/cancel`,
      reason ? { reason } : {},
    );
    return res.data.data;
  },

  async history(podOrderId: string): Promise<FulfillmentHistoryEntry[]> {
    const res = await apiClient.get<ApiResponse<FulfillmentHistoryEntry[]>>(
      `${BASE_PATH}/orders/${podOrderId}/history`,
    );
    return res.data.data;
  },

  async errors(podOrderId: string): Promise<FulfillmentError[]> {
    const res = await apiClient.get<ApiResponse<FulfillmentError[]>>(
      `${BASE_PATH}/orders/${podOrderId}/errors`,
    );
    return res.data.data;
  },
};
