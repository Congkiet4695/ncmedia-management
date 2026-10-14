'use client';

import { Loader2, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { useLocaleFormat } from '@/hooks/use-locale-format';

interface AccountShopTotalCardProps {
  /**
   * `totalShops` của API — tổng shop của MỌI kết nối khớp bộ lọc (mọi trang). `undefined` = đang tải lần đầu;
   * `null` = tải lỗi (hiện "—", lỗi chi tiết nằm ở bảng bên dưới).
   */
  total: number | null | undefined;
  /** Đang tải lần đầu / đang tải lại sau khi đổi bộ lọc. */
  loading: boolean;
}

/**
 * Thẻ "Tổng số shop" phía trên bảng TikTok Accounts. Đếm SHOP (không phải dòng kết nối) theo bộ lọc hiện tại —
 * số do backend đếm trên `pod_tiktok_shops`, không phải số dòng của trang đang mở.
 */
export function AccountShopTotalCard({ total, loading }: AccountShopTotalCardProps) {
  const { t } = useTranslation('pod');
  const { formatNumber } = useLocaleFormat();
  return (
    <Card className="w-full sm:w-64">
      <CardContent className="flex items-center gap-4 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Store className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('account.totalShops')}
          </p>
          <p className="flex items-center gap-2 text-2xl font-bold tabular-nums" aria-live="polite" aria-busy={loading}>
            {total === null ? (
              <span className="text-muted-foreground">—</span>
            ) : total === undefined ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('account.totalShopsLoading')} />
            ) : (
              <>
                {formatNumber(total)}
                {/* Đổi bộ lọc: giữ số cũ (keepPreviousData) kèm vòng quay nhỏ thay vì nháy về 0. */}
                {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
