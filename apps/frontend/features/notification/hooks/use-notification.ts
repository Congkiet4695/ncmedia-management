'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationServiceFor } from '../services/notification.service';
import type { NotificationChannelScope, NotificationEventQuery } from '../types';

const KEY = 'notification';

/**
 * Hook theo KÊNH: `organization` (mặc định — hành vi cũ) hoặc `me` (kênh cá nhân).
 * 🔴 Khoá cache có `scope` ⇒ cấu hình / thông báo của kênh tổ chức và kênh cá nhân không bao giờ lẫn vào nhau.
 */
export function useNotificationPreferences(scope: NotificationChannelScope = 'organization') {
  return useQuery({
    queryKey: [KEY, scope, 'preferences'],
    queryFn: () => notificationServiceFor(scope).getPreferences(),
  });
}

export function useSaveNotificationPreferences(scope: NotificationChannelScope = 'organization') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationServiceFor(scope).savePreferences,
    onSuccess: (saved) => queryClient.setQueryData([KEY, scope, 'preferences'], saved),
  });
}

export function useTelegramConfig(scope: NotificationChannelScope = 'organization') {
  return useQuery({
    queryKey: [KEY, scope, 'telegram'],
    queryFn: () => notificationServiceFor(scope).getTelegram(),
  });
}

export function useNotificationEvents(
  query: NotificationEventQuery,
  scope: NotificationChannelScope = 'organization',
) {
  return useQuery({
    queryKey: [KEY, scope, 'events', query],
    queryFn: () => notificationServiceFor(scope).listEvents(query),
    placeholderData: keepPreviousData,
  });
}

/** Lưu / xoá / gửi thử / gửi lại — mọi thao tác làm mới cấu hình và danh sách thông báo CỦA KÊNH ĐÓ. */
export function useTelegramActions(scope: NotificationChannelScope = 'organization') {
  const queryClient = useQueryClient();
  const service = notificationServiceFor(scope);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY, scope] });

  return {
    save: useMutation({ mutationFn: service.saveTelegram, onSettled: refresh }),
    remove: useMutation({ mutationFn: service.removeTelegram, onSettled: refresh }),
    // Gửi thử (kể cả thất bại) cập nhật trạng thái Connected / Disconnected phía backend.
    test: useMutation({ mutationFn: service.testTelegram, onSettled: refresh }),
    retryEvent: useMutation({ mutationFn: service.retryEvent, onSettled: refresh }),
    retryFailed: useMutation({ mutationFn: service.retryFailed, onSettled: refresh }),
  };
}
