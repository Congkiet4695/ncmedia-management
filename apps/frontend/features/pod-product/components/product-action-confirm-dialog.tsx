'use client';

import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import type { PodProductListItem } from '../types';

export type ProductLifecycleAction = 'DEACTIVATE' | 'DELETE';

interface ProductActionConfirmDialogProps {
  open: boolean;
  action: ProductLifecycleAction;
  /** Sản phẩm bị tác động — một hoặc nhiều (hành động hàng loạt). */
  products: PodProductListItem[];
  loading?: boolean;
  /** Đã xử lý xong bao nhiêu trong lượt hàng loạt — hiện trên nút để người dùng thấy đang chạy. */
  progress?: { done: number; total: number } | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Số sản phẩm liệt kê tên trong hộp xác nhận; nhiều hơn thì gộp thành "+N". */
const LISTED_NAMES = 5;

/**
 * Hộp xác nhận **Ngừng bán** / **Xoá** sản phẩm.
 *
 * 🔴 Hai hành động nói rõ hai hậu quả khác nhau: ngừng bán đảo ngược được (bật lại trên
 * Seller Center), xoá thì sản phẩm rời khỏi TikTok Shop (sàn giữ 30 ngày) và khỏi hệ thống —
 * Draft Listing / đơn hàng cũ vẫn giữ tham chiếu. Người dùng phải đọc được điều đó TRƯỚC khi
 * bấm, không phải sau.
 *
 * Nút xác nhận khoá trong lúc chạy: hàng loạt gọi API tuần tự từng sản phẩm, bấm lần hai
 * không được sinh lượt thứ hai.
 */
export function ProductActionConfirmDialog({
  open,
  action,
  products,
  loading,
  progress,
  onConfirm,
  onClose,
}: ProductActionConfirmDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const scope = action === 'DEACTIVATE' ? 'deactivate' : 'delete';
  const count = products.length;
  const listed = products.slice(0, LISTED_NAMES);
  const hidden = count - listed.length;

  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title={t(`products.${scope}.title`, { count })}
      description={t(`products.${scope}.question`, { count })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t('common:action.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading || count === 0}>
            {loading && <Loader2 className="animate-spin" />}
            {loading && progress
              ? t('products.bulk.progress', { done: progress.done, total: progress.total })
              : t(`products.${scope}.confirm`)}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <ul className="space-y-1 rounded-md border bg-muted/40 px-3 py-2">
          {listed.map((product) => (
            <li key={product.id} className="truncate">
              <span className="font-medium">{product.title?.trim() || product.tiktokProductId}</span>
              <span className="ml-1 font-mono text-xs text-muted-foreground">{product.tiktokProductId}</span>
              {product.shopName && (
                <span className="ml-1 text-xs text-muted-foreground">· {product.shopName}</span>
              )}
            </li>
          ))}
          {hidden > 0 && (
            <li className="text-xs text-muted-foreground">{t('products.bulk.more', { count: hidden })}</li>
          )}
        </ul>

        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p>{t(`products.${scope}.warning`)}</p>
            <p className="text-xs opacity-90">{t(`products.${scope}.relatedData`)}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
