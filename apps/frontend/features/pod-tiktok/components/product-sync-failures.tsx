'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { PodProductSyncFailure } from '../order-types';

/** Đọc danh sách sản phẩm lỗi từ `details` của dòng Latest Sync Status (PRODUCT). */
export function readProductSyncFailures(details: Record<string, unknown> | null): {
  items: PodProductSyncFailure[];
  omitted: number;
} {
  const items = Array.isArray(details?.failedProducts)
    ? (details.failedProducts as PodProductSyncFailure[])
    : [];
  const omitted =
    typeof details?.failedProductsOmitted === 'number' ? details.failedProductsOmitted : 0;
  return { items, omitted };
}

interface ProductSyncFailuresProps {
  items: PodProductSyncFailure[];
  omitted: number;
  /** Số lỗi của lượt (cột Lỗi) — dùng khi lượt cũ chưa lưu chi tiết từng sản phẩm. */
  failedCount: number;
}

/**
 * Chi tiết từng sản phẩm KHÔNG đồng bộ được của lượt gần nhất: bước lỗi, mã + thông điệp lỗi (TikTok
 * hoặc database), lỗi tạm thời hay cần xử lý, số lần thử, request id TikTok để mở ticket.
 */
export function ProductSyncFailures({ items, omitted, failedCount }: ProductSyncFailuresProps) {
  const { t } = useTranslation('pod');

  if (items.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        {t('latestSync.failedProducts.notRecorded', { count: failedCount })}
      </p>
    );
  }

  return (
    <div className="space-y-2 px-2 py-3">
      <p className="text-xs font-medium">{t('latestSync.failedProducts.title')}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t('latestSync.failedProducts.product')}</th>
              <th className="px-2 py-1.5 font-medium">{t('latestSync.failedProducts.step')}</th>
              <th className="px-2 py-1.5 font-medium">{t('latestSync.failedProducts.error')}</th>
              <th className="px-2 py-1.5 font-medium">{t('latestSync.failedProducts.kind')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.tiktokProductId} className="border-t align-top">
                <td className="max-w-[240px] px-2 py-1.5">
                  <p className="truncate font-medium" title={item.title ?? undefined}>
                    {item.title ?? '—'}
                  </p>
                  <p className="text-muted-foreground">TikTok ID: {item.tiktokProductId}</p>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {t(`latestSync.failedProducts.steps.${item.step}`, { defaultValue: item.step })}
                  <p className="text-muted-foreground">
                    {t('latestSync.failedProducts.attempts', { count: item.attempts })}
                  </p>
                </td>
                <td className="max-w-[360px] px-2 py-1.5">
                  <p className="break-words text-destructive">
                    {item.errorCode ? `${item.errorCode}: ` : ''}
                    {item.errorMessage ?? '—'}
                  </p>
                  {item.tiktokRequestId && (
                    <p className="text-muted-foreground">Request ID: {item.tiktokRequestId}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <Badge variant={item.retryable ? 'warning' : 'destructive'}>
                    {t(
                      item.retryable
                        ? 'latestSync.failedProducts.retryable'
                        : 'latestSync.failedProducts.permanent',
                    )}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {omitted > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('latestSync.failedProducts.omitted', { count: omitted })}
        </p>
      )}
    </div>
  );
}
