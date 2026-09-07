'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useApiError } from '@/hooks/use-api-error';
import { podMasterDataService } from './service';
import type { PodMasterDataResource, PodMasterDataSyncResult } from './types';

const KEY = 'pod-master-data';

/**
 * Trạng thái Master Data.
 *
 * 🔴 Không `refetchInterval`: dữ liệu này đổi vài lần một tháng. Nhịp làm mới duy nhất đáng
 * có là sau khi chính người dùng bấm Sync — xem `useSyncMasterData`.
 */
export function useMasterDataStatus() {
  return useQuery({
    queryKey: [KEY, 'status'],
    queryFn: () => podMasterDataService.status(),
    staleTime: 60 * 1000,
  });
}

/** Nhật ký — chỉ Super Admin gọi được; `enabled` để màn hình của org admin không bắn 403. */
export function useMasterDataLogs(
  params: { resource?: PodMasterDataResource; jobId?: string; limit?: number } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [KEY, 'logs', params],
    queryFn: () => podMasterDataService.logs(params),
    enabled,
  });
}

/**
 * Chạy đồng bộ (Super Admin).
 *
 * Sau khi xong làm mới **cả `pod-master-data` lẫn `pod-listing` / `pod-products`**: dữ liệu
 * vừa kéo về chính là nguồn cho dropdown danh mục/thương hiệu của Template — không làm mới
 * thì người dùng vừa sync xong mở form vẫn thấy trống và tưởng sync hỏng.
 */
export function useSyncMasterData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { resources?: PodMasterDataResource[] } = {}) =>
      podMasterDataService.sync(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] });
      void queryClient.invalidateQueries({ queryKey: ['pod-listing'] });
      void queryClient.invalidateQueries({ queryKey: ['pod-products'] });
    },
  });
}

/**
 * Bấm Sync và tự báo kết quả bằng toast.
 *
 * Thành công thì nói rõ **bao nhiêu bản ghi trong bao nhiêu giây**; hỏng thì hiện **nguyên
 * văn lỗi của TikTok** chứ không phải "đồng bộ thất bại" — lỗi thật (429, token hết hạn,
 * shop không đủ quyền) là thứ duy nhất giúp người vận hành biết phải làm gì tiếp.
 */
export function useSyncMasterDataWithToast() {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const sync = useSyncMasterData();

  const run = async (
    resources?: PodMasterDataResource[],
  ): Promise<PodMasterDataSyncResult | null> => {
    try {
      const result = await sync.mutateAsync({ resources });
      const seconds = (result.durationMs / 1000).toFixed(1);

      if (result.status === 'FAILED') {
        toast.error(t('masterData.syncFailed'), { description: result.error ?? undefined });
      } else if (result.status === 'PARTIAL') {
        toast.warning(t('masterData.syncPartial', { records: result.totalRecords }), {
          description: result.error ?? undefined,
        });
      } else {
        toast.success(t('masterData.syncSuccess', { records: result.totalRecords, seconds }));
      }
      return result;
    } catch (error) {
      toast.error(t('masterData.syncFailed'), { description: translateApiError(error) });
      return null;
    }
  };

  return { run, isPending: sync.isPending };
}
