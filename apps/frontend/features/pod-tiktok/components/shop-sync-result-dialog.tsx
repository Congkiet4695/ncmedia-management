'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ShopStatusBadge } from './shop-status-badge';
import type { PodTiktokShopSyncItem, PodTiktokShopSyncResult } from '../types';

const RESULT_VARIANT: Record<PodTiktokShopSyncItem['result'], 'success' | 'muted' | 'destructive'> = {
  SYNCED: 'success',
  SKIPPED: 'muted',
  FAILED: 'destructive',
};

/**
 * Kết quả một lượt **Sync Shops** — tổng kết + từng shop.
 *
 * 🔴 Liệt kê TỪNG shop, không chỉ con số: shop lỗi/bỏ qua phải kèm mã + thông điệp để người vận
 * hành biết shop nào cần uỷ quyền lại hay kiểm tra ở Seller Center.
 */
export function ShopSyncResultDialog({
  result,
  onClose,
}: {
  result: PodTiktokShopSyncResult | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);

  return (
    <Modal
      open={Boolean(result)}
      onClose={onClose}
      title={t('account.shopSync.resultTitle')}
      description={
        result
          ? t('account.shopSync.summary', {
              synced: result.syncedShops,
              total: result.totalShops,
              active: result.activeShops,
              inactive: result.inactiveShops,
              deauthorized: result.deauthorizedShops,
              skipped: result.skippedShops,
              failed: result.failedShops,
            })
          : undefined
      }
      className="max-w-3xl"
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('common:action.close')}
          </Button>
        </div>
      }
    >
      {result && result.items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('account.shopSync.empty')}
        </p>
      )}
      {result && result.items.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('account.shopName')}</TableHead>
                <TableHead>{t('account.accountName')}</TableHead>
                <TableHead>{t('account.shopSync.result')}</TableHead>
                <TableHead>{t('account.shopSync.shopStatus')}</TableHead>
                <TableHead>{t('account.shopSync.error')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((item) => (
                <TableRow key={item.shopId}>
                  <TableCell>
                    <p className="font-medium">{item.shopName}</p>
                    <p className="text-xs text-muted-foreground">{item.tiktokShopId}</p>
                  </TableCell>
                  <TableCell>{item.accountName}</TableCell>
                  <TableCell>
                    <Badge variant={RESULT_VARIANT[item.result]}>
                      {t(`account.shopSync.resultStatus.${item.result}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ShopStatusBadge status={item.shopStatus} />
                    {item.previousShopStatus !== item.shopStatus && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('account.shopSync.changedFrom', {
                          status: t(`account.shopStatus.${item.previousShopStatus}`),
                        })}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[260px] text-xs text-destructive">
                    {[item.errorCode, item.errorMessage].filter(Boolean).join(' · ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Modal>
  );
}
