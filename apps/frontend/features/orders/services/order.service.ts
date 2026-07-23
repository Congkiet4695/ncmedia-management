import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  CreateOrderNotePayload,
  CreateOrderPayload,
  Order,
  OrderListResult,
  OrderNote,
  OrderQuery,
  OrderSellerOption,
  UpdateItemFulfillmentPayload,
  UpdateOrderNotePayload,
  UpdateOrderPayload,
  UpdateStatusPayload,
} from '../types';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

export const orderService = {
  async list(query: OrderQuery): Promise<OrderListResult> {
    const res = await apiClient.get<ApiResponse<OrderListResult>>('/orders', {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<Order> {
    const res = await apiClient.get<ApiResponse<Order>>(`/orders/${id}`);
    return res.data.data;
  },

  async create(payload: CreateOrderPayload): Promise<Order> {
    const res = await apiClient.post<ApiResponse<Order>>('/orders', payload);
    return res.data.data;
  },

  async update(id: string, payload: UpdateOrderPayload): Promise<Order> {
    const res = await apiClient.patch<ApiResponse<Order>>(`/orders/${id}`, payload);
    return res.data.data;
  },

  async updateStatus(id: string, payload: UpdateStatusPayload): Promise<Order> {
    const res = await apiClient.patch<ApiResponse<Order>>(`/orders/${id}/status`, payload);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`/orders/${id}`);
  },

  /** Chỉ ADMIN gọi (filter Seller). EMPLOYEE không gọi endpoint này. */
  async listSellers(): Promise<OrderSellerOption[]> {
    const res = await apiClient.get<ApiResponse<OrderSellerOption[]>>('/orders/sellers');
    return res.data.data;
  },

  // --- Fulfillment workflow ---

  /** Nhận xử lý (claim) đơn — Fulfillment. */
  async claim(id: string): Promise<Order> {
    const res = await apiClient.post<ApiResponse<Order>>(`/orders/${id}/claim`);
    return res.data.data;
  },

  /** Release đơn (Admin) — về WAITING. */
  async release(id: string): Promise<Order> {
    const res = await apiClient.post<ApiResponse<Order>>(`/orders/${id}/release`);
    return res.data.data;
  },

  /** Cập nhật Tracking + Fulfillment Status theo TỪNG Item. */
  async updateItemFulfillment(
    id: string,
    itemId: string,
    payload: UpdateItemFulfillmentPayload,
  ): Promise<Order> {
    const res = await apiClient.put<ApiResponse<Order>>(
      `/orders/${id}/items/${itemId}/fulfillment`,
      payload,
    );
    return res.data.data;
  },

  async fulfillStatus(id: string, payload: UpdateStatusPayload): Promise<Order> {
    const res = await apiClient.put<ApiResponse<Order>>(`/orders/${id}/status`, payload);
    return res.data.data;
  },

  // --- OrderNote (Seller / Warehouse) CRUD ---

  async listNotes(id: string): Promise<OrderNote[]> {
    const res = await apiClient.get<ApiResponse<OrderNote[]>>(`/orders/${id}/notes`);
    return res.data.data;
  },

  async createNote(id: string, payload: CreateOrderNotePayload): Promise<OrderNote> {
    const res = await apiClient.post<ApiResponse<OrderNote>>(`/orders/${id}/notes`, payload);
    return res.data.data;
  },

  async updateNote(noteId: string, payload: UpdateOrderNotePayload): Promise<OrderNote> {
    const res = await apiClient.put<ApiResponse<OrderNote>>(`/orders/notes/${noteId}`, payload);
    return res.data.data;
  },

  async deleteNote(noteId: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`/orders/notes/${noteId}`);
  },
};
