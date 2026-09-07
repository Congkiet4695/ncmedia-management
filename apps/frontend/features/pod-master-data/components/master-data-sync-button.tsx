'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSyncMasterDataWithToast } from '../hooks';
import type { PodMasterDataResource } from '../types';

interface MasterDataSyncButtonProps {
  /** Bỏ trống = chạy cả ba tài nguyên theo đúng thứ tự phụ thuộc. */
  resources?: PodMasterDataResource[];
  label?: string;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline';
  disabled?: boolean;
  onDone?: () => void;
}

/**
 * Nút **Sync Now** của TikTok Master Data — chỉ hiện với Super Admin.
 *
 * 🔴 Việc ẩn nút KHÔNG phải là cơ chế phân quyền: hàng rào thật là `SuperAdminGuard` +
 * `platform.masterdata.sync` ở backend. Ẩn nút chỉ để Admin tổ chức không bấm vào một thứ
 * chắc chắn trả 403.
 *
 * Trong lúc chạy: nút khoá và hiện spinner. Một lượt đồng bộ đầy đủ mất hàng chục giây
 * (12.000 danh mục + 15.000 brand + thuộc tính), không có phản hồi thì người dùng sẽ bấm
 * lại — và lần bấm thứ hai chỉ nhận 409.
 */
export function MasterDataSyncButton({
  resources,
  label,
  size = 'default',
  variant = 'default',
  disabled,
  onDone,
}: MasterDataSyncButtonProps) {
  const { t } = useTranslation('pod');
  const { run, isPending } = useSyncMasterDataWithToast();

  return (
    <Button
      variant={variant}
      size={size}
      disabled={isPending || disabled}
      onClick={() => {
        void run(resources).then(() => onDone?.());
      }}
    >
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {isPending ? t('masterData.syncing') : (label ?? t('masterData.syncNow'))}
    </Button>
  );
}
