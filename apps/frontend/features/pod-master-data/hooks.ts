'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useApiError } from '@/hooks/use-api-error';
import { podMasterDataService } from './service';
import type {
  PodMasterDataOverview,
  PodMasterDataResource,
  PodMasterDataResourceStatus,
  PodMasterDataSyncStarted,
} from './types';

const KEY = 'pod-master-data';

/** Nhịp hỏi trạng thái khi có lượt đang chạy. Quét thương hiệu kéo dài hàng giờ — 5s là đủ mượt. */
const RUNNING_POLL_MS = 5_000;

/** Có tài nguyên nào đang chạy không — cờ do backend quyết định, frontend không tự đoán. */
export function isMasterDataRunning(overview?: PodMasterDataOverview): boolean {
  return overview?.resources.some((row) => row.status === 'RUNNING') ?? false;
}

/**
 * Trạng thái Master Data.
 *
 * 🔴 Chỉ polling khi có lượt ĐANG chạy: dữ liệu này đổi vài lần một tháng, nhưng một lượt
 * đồng bộ thương hiệu chạy nền hàng giờ và người vận hành cần thấy nó còn sống. Đứng yên thì
 * dừng — polling vĩnh viễn là cách âm thầm đốt tài nguyên của cả trình duyệt lẫn server.
 */
export function useMasterDataStatus() {
  return useQuery({
    queryKey: [KEY, 'status'],
    queryFn: () => podMasterDataService.status(),
    staleTime: 60 * 1000,
    refetchInterval: (result) => (isMasterDataRunning(result.state.data) ? RUNNING_POLL_MS : false),
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
 * Gửi yêu cầu đồng bộ (Super Admin). Backend trả 202 ngay; lượt chạy nền.
 *
 * Sau khi được nhận, làm mới `pod-master-data` để bảng chuyển sang RUNNING và bắt đầu polling.
 * Dropdown danh mục/thương hiệu (`pod-listing`, `pod-products`) được làm mới khi lượt KẾT THÚC
 * — xem `useSyncMasterDataWithToast`.
 */
export function useSyncMasterData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { resources?: PodMasterDataResource[] } = {}) =>
      podMasterDataService.sync(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY, 'status'] });
    },
  });
}

/**
 * Bấm Sync, báo "đã nhận" ngay, rồi theo dõi lượt qua `status` và báo kết quả khi nó kết thúc.
 *
 * Thành công thì nói rõ **bao nhiêu bản ghi**; hỏng thì hiện **nguyên văn lỗi của TikTok**
 * chứ không phải "đồng bộ thất bại" — lỗi thật (429, token hết hạn, shop không đủ quyền,
 * prefix thương hiệu bị thiếu) là thứ duy nhất giúp người vận hành biết phải làm gì tiếp.
 *
 * `isPending` = đang gửi yêu cầu HOẶC có lượt đang chạy (khoá là toàn cục: một lượt tại một
 * thời điểm, nên mọi nút Sync đều khoá trong lúc đó — kể cả lượt do người khác bấm).
 */
export function useSyncMasterDataWithToast() {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const queryClient = useQueryClient();
  const sync = useSyncMasterData();
  const status = useMasterDataStatus();
  const [watchJobId, setWatchJobId] = useState<string | null>(null);
  const announced = useRef<string | null>(null);

  const running = isMasterDataRunning(status.data);

  // Lượt mình vừa bấm đã kết thúc ⇒ đọc kết quả từ trạng thái và báo một lần duy nhất.
  useEffect(() => {
    const overview = status.data;
    if (!watchJobId || !overview || running || announced.current === watchJobId) return;

    const rows = overview.resources.filter((row) => row.jobId === watchJobId);
    if (rows.length === 0) return;

    announced.current = watchJobId;
    setWatchJobId(null);
    announceOutcome(rows, t);

    // Dữ liệu vừa kéo về chính là nguồn cho dropdown danh mục/thương hiệu của Template —
    // không làm mới thì người dùng mở form vẫn thấy danh sách cũ và tưởng sync hỏng.
    void queryClient.invalidateQueries({ queryKey: ['pod-listing'] });
    void queryClient.invalidateQueries({ queryKey: ['pod-products'] });
  }, [status.data, running, watchJobId, queryClient, t]);

  const run = async (
    resources?: PodMasterDataResource[],
  ): Promise<PodMasterDataSyncStarted | null> => {
    try {
      const started = await sync.mutateAsync({ resources });
      setWatchJobId(started.jobId);
      toast.info(t('masterData.syncStarted'));
      return started;
    } catch (error) {
      toast.error(t('masterData.syncFailed'), { description: translateApiError(error) });
      return null;
    }
  };

  return { run, isPending: sync.isPending || running };
}

/** Gộp kết quả từng tài nguyên của một lượt thành MỘT toast. */
function announceOutcome(
  rows: PodMasterDataResourceStatus[],
  t: ReturnType<typeof useTranslation>['t'],
): void {
  const failed = rows.filter((row) => row.status === 'FAILED');
  const partial = rows.filter((row) => row.status === 'PARTIAL');
  const records = rows.reduce((sum, row) => sum + row.totalRecords, 0);
  const seconds = (rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) / 1000).toFixed(1);
  const errors = [...failed, ...partial]
    .filter((row) => row.lastError)
    .map((row) => `${t(`masterData.names.${row.resource}`)}: ${row.lastError}`)
    .join(' · ');

  if (failed.length === rows.length) {
    toast.error(t('masterData.syncFailed'), { description: errors || undefined });
  } else if (failed.length > 0 || partial.length > 0) {
    toast.warning(t('masterData.syncPartial', { records }), { description: errors || undefined });
  } else {
    toast.success(t('masterData.syncSuccess', { records, seconds }));
  }
}
