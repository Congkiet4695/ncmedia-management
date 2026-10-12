'use client';

import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useEmployeeWorkListingDetails } from '../hooks/use-employee-work';
import type { EmployeeWorkFilters } from '../types';
import { ShopLiveBadge } from './shop-live-badge';

export type ListingDialogMode = 'employees' | 'shops';

/**
 * Popup của thẻ "Nhân viên có listing" / "Shop được listing". Backend dựng danh sách từ CHÍNH các cặp
 * (người × shop) mà thẻ đếm, cùng bộ lọc ⇒ số người = thẻ; số shop duy nhất = thẻ (số dòng shop × người có
 * thể lớn hơn — ghi rõ cả hai để không hiểu nhầm). Danh sách giới hạn theo số nhân viên / shop của tổ chức
 * ⇒ cuộn trong popup, không phân trang.
 */
export function EmployeeWorkListingDialog({
  mode,
  onClose,
  filters,
}: {
  mode: ListingDialogMode | null;
  onClose: () => void;
  filters: EmployeeWorkFilters;
}) {
  const { t } = useTranslation(['report', 'common']);
  const { formatNumber } = useLocaleFormat();
  const translateApiError = useApiError();
  const query = useEmployeeWorkListingDetails(filters, mode !== null);
  const data = query.data;
  const range = { from: data?.from ?? filters.from ?? '', to: data?.to ?? filters.to ?? '' };

  const rows = mode === 'shops' ? (data?.shops.length ?? 0) : (data?.employees.length ?? 0);

  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      className={mode === 'shops' ? 'max-w-4xl' : 'max-w-2xl'}
      title={mode === 'shops' ? t('employeeWork.listingDialog.shopsTitle') : t('employeeWork.listingDialog.employeesTitle')}
      description={
        mode === 'shops'
          ? t('employeeWork.listingDialog.shopsDescription', range)
          : t('employeeWork.listingDialog.employeesDescription', range)
      }
    >
      {query.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-sm">
          <p className="text-destructive">{translateApiError(query.error)}</p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </div>
      ) : !data || rows === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('employeeWork.listingDialog.empty')}</p>
      ) : (
        <>
          <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {mode === 'shops'
              ? t('employeeWork.listingDialog.shopsSummary', { shops: data.uniqueShops, rows: data.shops.length })
              : t('employeeWork.listingDialog.employeesSummary', { count: data.employees.length })}
          </p>
          <div className="overflow-x-auto">
            {mode === 'shops' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('employeeWork.listingDialog.connection')}</TableHead>
                    <TableHead>{t('employeeWork.listingDialog.shop')}</TableHead>
                    <TableHead>{t('employeeWork.listingDialog.employee')}</TableHead>
                    <TableHead className="text-right">{t('employeeWork.listingDialog.listings')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.shops.map((row) => (
                    <TableRow key={`${row.shopId}:${row.userId}`}>
                      <TableCell className="text-sm">{row.accountName}</TableCell>
                      <TableCell className="text-sm">
                        <span className="font-medium">{row.shopName}</span>
                        <span className="ml-2 inline-block align-middle">
                          <ShopLiveBadge status={row.shopStatus} />
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <p>{row.userName}</p>
                        {row.userEmail && row.userEmail !== row.userName && (
                          <p className="text-xs text-muted-foreground">{row.userEmail}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.listings)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('employeeWork.listingDialog.employee')}</TableHead>
                    <TableHead>{t('employeeWork.listingDialog.email')}</TableHead>
                    <TableHead className="text-right">{t('employeeWork.listingDialog.shops')}</TableHead>
                    <TableHead className="text-right">{t('employeeWork.listingDialog.listings')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.employees.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell className="text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{row.name}</span>
                          {row.deleted ? (
                            <Badge variant="muted">{t('employeeWork.listingDialog.deleted')}</Badge>
                          ) : (
                            !row.active && <Badge variant="muted">{t('employeeWork.badge.inactive')}</Badge>
                          )}
                          {!row.deleted && !row.isEmployee && (
                            <Badge variant="default">{t('employeeWork.badge.notEmployee')}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.shops)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.listings)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
