'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountService } from '@/features/accounts/services/account.service';
import { orderService } from '../services/order.service';
import type {
  CreateOrderNotePayload,
  CreateOrderPayload,
  OrderQuery,
  UpdateItemFulfillmentPayload,
  UpdateOrderNotePayload,
  UpdateOrderPayload,
  UpdateStatusPayload,
} from '../types';

const ORDERS_KEY = 'orders';

export function useOrders(query: OrderQuery) {
  return useQuery({
    queryKey: [ORDERS_KEY, 'list', query],
    queryFn: () => orderService.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id?: string) {
  return useQuery({
    queryKey: [ORDERS_KEY, 'detail', id],
    queryFn: () => orderService.get(id as string),
    enabled: Boolean(id),
  });
}

/**
 * useOrderSellers — danh sách Seller cho filter (ADMIN). `enabled=false` (EMPLOYEE) → KHÔNG gọi
 * GET /orders/sellers.
 */
export function useOrderSellers(enabled = true) {
  return useQuery({
    queryKey: [ORDERS_KEY, 'sellers'],
    queryFn: () => orderService.listSellers(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Danh sách Account (theo phạm vi user) để chọn khi tạo Order. Lọc theo platform nếu có. */
export function useOrderAccounts(platformId?: string) {
  return useQuery({
    queryKey: [ORDERS_KEY, 'accounts', platformId ?? 'all'],
    queryFn: () => accountService.list({ platformId, limit: 100, sortBy: 'name', sortOrder: 'asc' }),
    staleTime: 60 * 1000,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOrderPayload) => orderService.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateOrderPayload }) =>
      orderService.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateStatusPayload }) =>
      orderService.updateStatus(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

// --- Fulfillment mutations ---

export function useClaimOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.claim(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useReleaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderService.release(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useUpdateItemFulfillment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      itemId,
      payload,
    }: {
      id: string;
      itemId: string;
      payload: UpdateItemFulfillmentPayload;
    }) => orderService.updateItemFulfillment(id, itemId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useFulfillStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateStatusPayload }) =>
      orderService.fulfillStatus(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

// --- OrderNote (Seller / Warehouse) CRUD mutations ---

export function useCreateOrderNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateOrderNotePayload }) =>
      orderService.createNote(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useUpdateOrderNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, payload }: { noteId: string; payload: UpdateOrderNotePayload }) =>
      orderService.updateNote(noteId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}

export function useDeleteOrderNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => orderService.deleteNote(noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORDERS_KEY] }),
  });
}
