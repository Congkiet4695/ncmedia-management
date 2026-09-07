'use client';

import { RefreshCw, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSyncResourceWithToast } from '../hooks';
import type { PodResourceType } from '../types';

interface ResourceSyncButtonProps {
  resource: PodResourceType;
  /** Nhãn riêng ("Sync Categories"). Bỏ trống dùng nhãn chung. */
  label?: string;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline';
  disabled?: boolean;
  onDone?: () => void;
}

/**
 * Nút Sync cho tài nguyên **của tổ chức** (kho hàng).
 *
 * 🔴 Không còn dùng cho danh mục / thương hiệu / thuộc tính: đó là dữ liệu master toàn cục
 * và chỉ Super Admin đồng bộ (`MasterDataSyncButton`).
 *
 * Trong lúc chạy: nút khoá và hiện spinner — một lượt sync mất hơn 10 giây, không có phản
 * hồi thì người dùng sẽ bấm lại nhiều lần và đốt quota TikTok.
 *
 * Kết quả (số bản ghi / thời gian / lỗi nguyên văn) do `useSyncResourceWithToast` báo.
 */
export function ResourceSyncButton({
  resource,
  label,
  size = 'default',
  variant = 'outline',
  disabled,
  onDone,
}: ResourceSyncButtonProps) {
  const { t } = useTranslation('pod');
  const { run, isPending, variables } = useSyncResourceWithToast();
  // Nhiều nút cùng dùng một hook ⇒ chỉ nút ĐANG chạy mới quay spinner.
  const running = isPending && variables?.resource === resource;

  return (
    <Button
      variant={variant}
      size={size}
      disabled={running || disabled}
      onClick={() => {
        void run(resource).then(() => onDone?.());
      }}
    >
      {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {running ? t('resources.syncing') : (label ?? t('resources.sync'))}
    </Button>
  );
}
