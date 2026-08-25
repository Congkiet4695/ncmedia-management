'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { podListingSessionService } from './service';
import type {
  CreateSessionPayload,
  PodSessionImportMode,
  PodSessionProductQuery,
  PodSessionQuery,
  UpdateSessionPayload,
  UpdateSessionProductPayload,
} from './types';

const KEY = 'pod-listing-session';

/** Lượt đăng đang chạy ⇒ hỏi lại server cho tới khi có kết quả. */
const RUNNING_STATUSES = ['LISTING'];
const POLL_MS = 3_000;

export function useListingSessions(query: PodSessionQuery = {}) {
  return useQuery({
    queryKey: [KEY, 'list', query],
    queryFn: () => podListingSessionService.list(query),
    placeholderData: keepPreviousData,
    // Đang chạy thì tự làm mới; đứng yên thì thôi — polling vĩnh viễn là cách âm thầm đốt
    // tài nguyên của cả trình duyệt lẫn server.
    refetchInterval: (result) =>
      result.state.data?.items.some((session) => RUNNING_STATUSES.includes(session.status))
        ? POLL_MS
        : false,
  });
}

export function useListingSession(id?: string) {
  return useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => podListingSessionService.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (result) =>
      result.state.data && RUNNING_STATUSES.includes(result.state.data.status) ? POLL_MS : false,
  });
}

export function useSessionProducts(id?: string, query: PodSessionProductQuery = {}, live = false) {
  return useQuery({
    queryKey: [KEY, 'products', id, query],
    queryFn: () => podListingSessionService.listProducts(id as string, query),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    refetchInterval: live ? POLL_MS : false,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSessionPayload) => podListingSessionService.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSessionPayload }) =>
      podListingSessionService.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podListingSessionService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useImportSessionProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file, mode }: { id: string; file: File; mode?: PodSessionImportMode }) =>
      podListingSessionService.import(id, file, mode ?? 'APPEND'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateSessionProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      productId,
      payload,
    }: {
      id: string;
      productId: string;
      payload: UpdateSessionProductPayload;
    }) => podListingSessionService.updateProduct(id, productId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSessionProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ids }: { id: string; ids: string[] }) =>
      podListingSessionService.removeProducts(id, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRemoveAllSessionProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podListingSessionService.removeAllProducts(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function usePreviewSessionProduct() {
  return useMutation({
    mutationFn: ({ id, productId, shopId }: { id: string; productId: string; shopId?: string }) =>
      podListingSessionService.previewProduct(id, productId, shopId),
  });
}

export function useValidateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => podListingSessionService.validate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useStartSessionListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      podListingSessionService.start(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}
