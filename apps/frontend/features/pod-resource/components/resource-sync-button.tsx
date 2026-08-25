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
  categoryIds?: string[];
  onDone?: () => void;
}

/**
 * Nút Sync dùng chung cho mọi màn hình tài nguyên.
 *
 * Trong lúc chạy: nút khoá và hiện spinner — một lượt sync danh mục mất hơn 10 giây, không
 * có phản hồi thì người dùng sẽ bấm lại nhiều lần và đốt quota TikTok.
 *
 * Kết quả (số bản ghi / thời gian / lỗi nguyên văn) do `useSyncResourceWithToast` báo.
 */
export function ResourceSyncButton({
  resource,
  label,
  size = 'default',
  variant = 'outline',
  disabled,
  categoryIds,
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
        void run(resource, { categoryIds }).then(() => onDone?.());
      }}
    >
      {running ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      {running ? t('resources.syncing') : (label ?? t('resources.sync'))}
    </Button>
  );
}
