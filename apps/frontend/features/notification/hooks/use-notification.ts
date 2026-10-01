'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '../services/notification.service';
import type { NotificationEventQuery } from '../types';

const KEY = 'notification';

export function useNotificationPreferences() {
  return useQuery({
    queryKey: [KEY, 'preferences'],
    queryFn: () => notificationService.getPreferences(),
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationService.savePreferences,
    onSuccess: (saved) => queryClient.setQueryData([KEY, 'preferences'], saved),
  });
}

export function useTelegramConfig() {
  return useQuery({
    queryKey: [KEY, 'telegram'],
    queryFn: () => notificationService.getTelegram(),
  });
}

export function useNotificationEvents(query: NotificationEventQuery) {
  return useQuery({
    queryKey: [KEY, 'events', query],
    queryFn: () => notificationService.listEvents(query),
    placeholderData: keepPreviousData,
  });
}

/** Lưu / xoá / gửi thử / gửi lại — mọi thao tác làm mới cấu hình và danh sách thông báo. */
export function useTelegramActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });

  return {
    save: useMutation({ mutationFn: notificationService.saveTelegram, onSettled: refresh }),
    remove: useMutation({ mutationFn: notificationService.removeTelegram, onSettled: refresh }),
    // Gửi thử (kể cả thất bại) cập nhật trạng thái Connected / Disconnected phía backend.
    test: useMutation({ mutationFn: notificationService.testTelegram, onSettled: refresh }),
    retryEvent: useMutation({ mutationFn: notificationService.retryEvent, onSettled: refresh }),
    retryFailed: useMutation({ mutationFn: notificationService.retryFailed, onSettled: refresh }),
  };
}
