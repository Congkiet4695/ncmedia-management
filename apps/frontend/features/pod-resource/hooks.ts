'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useApiError } from '@/hooks/use-api-error';
import { podResourceService } from './service';
import type { PodResourceSyncResult, PodResourceType } from './types';

const KEY = 'pod-resource';

export function useResourceStatus() {
  return useQuery({
    queryKey: [KEY, 'status'],
    queryFn: () => podResourceService.status(),
  });
}

export function useResourceLogs(
  params: { resource?: PodResourceType; jobId?: string; limit?: number } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [KEY, 'logs', params],
    queryFn: () => podResourceService.logs(params),
    enabled,
  });
}

/**
 * Chạy Sync cho một tài nguyên.
 *
 * Sau khi xong làm mới **cả `pod-resource` lẫn `pod-listing`**: dữ liệu vừa kéo về chính
 * là nguồn cho dropdown danh mục/thương hiệu/kho của Template — không làm mới thì người
 * dùng vừa sync xong mở form vẫn thấy trống và tưởng sync hỏng.
 */
export function useSyncResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ resource, shopId }: { resource: PodResourceType; shopId?: string }) =>
      podResourceService.sync(resource, { shopId }),
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
 * Thành công thì nói rõ **bao nhiêu bản ghi trong bao nhiêu giây**, hỏng thì hiện **nguyên
 * văn lỗi của TikTok** chứ không phải "đồng bộ thất bại".
 */
export function useSyncResourceWithToast() {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const sync = useSyncResource();

  const run = async (resource: PodResourceType): Promise<PodResourceSyncResult | null> => {
    try {
      const result = await sync.mutateAsync({ resource });
      const seconds = (result.durationMs / 1000).toFixed(1);

      if (result.status === 'FAILED') {
        toast.error(t('resources.syncFailed'), { description: result.error ?? undefined });
      } else if (result.status === 'PARTIAL') {
        toast.warning(
          t('resources.syncPartial', { records: result.totalRecords, failed: result.failedShops }),
          { description: result.error ?? undefined },
        );
      } else {
        toast.success(t('resources.syncSuccess', { records: result.totalRecords, seconds }));
      }
      return result;
    } catch (error) {
      toast.error(t('resources.syncFailed'), { description: translateApiError(error) });
      return null;
    }
  };

  return { run, isPending: sync.isPending, variables: sync.variables };
}
