'use client';

import Link from 'next/link';
import { History, ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import type { PodReturn } from '../types';
import { STATUS_GROUP_VARIANT, humanizeCode, useReturnLabels } from './return-labels';

interface ReturnTableProps {
  items: PodReturn[];
  loading: boolean;
  onViewHistory: (request: PodReturn) => void;
}

/**
 * Bảng Return Orders. Mọi ô chữ dài (Order ID, tên sản phẩm, lý do) đều `break-words` / `line-clamp`
 * để bảng không tràn; trên màn hẹp bảng cuộn ngang trong khung của nó (không làm tràn trang).
 */
export function ReturnTable({ items, loading, onViewHistory }: ReturnTableProps) {
  const { t } = useTranslation('podReturn');
  const { formatCurrency, formatDateTime } = useLocaleFormat();
  const labels = useReturnLabels();

  if (!loading && items.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[170px]">{t('col.order')}</TableHead>
            <TableHead className="w-[130px]">{t('col.type')}</TableHead>
            <TableHead className="w-[170px]">{t('col.reason')}</TableHead>
            <TableHead className="w-[160px]">{t('col.status')}</TableHead>
            <TableHead>{t('col.item')}</TableHead>
            <TableHead className="w-[110px] text-right">{t('col.paid')}</TableHead>
            <TableHead className="w-[150px] text-right">{t('col.refund')}</TableHead>
            <TableHead className="w-[110px] text-center">{t('col.history')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 6 }, (_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 8 }, (__, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : items.map((request) => (
                <TableRow key={request.id} className="align-top">
                  <TableCell>
                    {request.orderId ? (
                      <Link
                        href={`/dashboard/pod/orders/${request.orderId}`}
                        className="break-all font-mono text-xs font-medium text-primary hover:underline"
                      >
                        {request.tiktokOrderId}
                      </Link>
                    ) : (
                      <Tooltip content={t('orderNotSynced')}>
                        <span className="break-all font-mono text-xs">{request.tiktokOrderId}</span>
                      </Tooltip>
                    )}
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {t('requestId')}: {request.tiktokReturnId}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={request.shopName ?? undefined}>
                      {request.shopName ?? request.accountName ?? '—'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatDateTime(request.requestedAt)}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{labels.type(request.returnType)}</p>
                    <p className="break-all font-mono text-[10px] text-muted-foreground">{request.returnType}</p>
                  </TableCell>
                  <TableCell>
                    <p className="line-clamp-3 break-words text-sm" title={request.reasonText ?? request.reasonCode ?? undefined}>
                      {request.reasonText ?? humanizeCode(request.reasonCode)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_GROUP_VARIANT[request.statusGroup]}>{labels.group(request.statusGroup)}</Badge>
                    <p className="mt-1 text-xs">{labels.status(request.returnStatus)}</p>
                    <p className="break-all font-mono text-[10px] text-muted-foreground">{request.returnStatus}</p>
                    {request.arbitrationStatus && (
                      <p className="mt-0.5 text-[11px] text-amber-600">
                        {t('arbitration')}: {humanizeCode(request.arbitrationStatus)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {request.itemGroups.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t('noItems')}</span>
                    ) : (
                      <ul className="space-y-2">
                        {request.itemGroups.map((item, index) => (
                          <li key={index} className="flex min-w-0 gap-2">
                            {item.productImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- ảnh CDN TikTok, không qua Next Image
                              <img
                                src={item.productImageUrl}
                                alt=""
                                className="size-10 shrink-0 rounded border object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <span className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted">
                                <ImageOff className="size-4 text-muted-foreground" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="line-clamp-2 break-words text-sm" title={item.productName ?? undefined}>
                                {item.productName ?? '—'}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {[item.sellerSku, item.skuName].filter(Boolean).join(' · ') || '—'}
                              </p>
                              <p className="text-[11px]">{t('qty', { count: item.quantity })}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {request.paidAmount ? (
                      formatCurrency(request.paidAmount, request.currency)
                    ) : (
                      <Tooltip content={t('paidUnavailable')}>
                        <span className="text-muted-foreground">{t('notAvailable')}</span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="tabular-nums">
                      {request.requestedRefund ? formatCurrency(request.requestedRefund, request.currency) : t('notAvailable')}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {request.refundCompleted ? t('amount.refundedByTiktok') : t('amount.requestedOnly')}
                    </p>
                    {request.orderSettledRefund && (
                      <Tooltip content={t('amount.settledOrderHint')}>
                        <p className="text-[11px] text-muted-foreground underline decoration-dotted">
                          {t('amount.settledShort', {
                            amount: formatCurrency(request.orderSettledRefund, request.currency),
                          })}
                        </p>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="outline" size="sm" onClick={() => onViewHistory(request)}>
                      <History className="size-4" />
                      {t('viewHistory')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
