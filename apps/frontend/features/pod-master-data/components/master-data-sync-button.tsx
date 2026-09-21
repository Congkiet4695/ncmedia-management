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
 * Trong lúc chạy: nút khoá và hiện spinner. Backend nhận yêu cầu rồi chạy NỀN (202) — quét
 * thương hiệu là hàng chục nghìn lời gọi TikTok, kéo dài hàng giờ. Nút bám theo trạng thái
 * RUNNING từ `status` (polling), nên vẫn khoá đúng kể cả khi người dùng tải lại trang giữa
 * chừng hoặc lượt do người khác bấm; bấm thêm chỉ nhận 409.
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
