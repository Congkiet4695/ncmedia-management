'use client';

import Link from 'next/link';
import { Loader2, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { useFlashSaleAutoChain } from '../hooks';
import type { PodFlashSaleDetail } from '../types';

interface FlashSaleAutoChainCardProps {
  flashSale: PodFlashSaleDetail;
  /** Người dùng có quyền bật/tắt Auto (\`pod.flashsale.publish\`). */
  canToggle: boolean;
  toggling: boolean;
  /** Số giờ trước khi hết hạn thì tạo đợt kế tiếp — hiển thị trong câu gợi ý. */
  leadHours: number;
  onToggle: (enabled: boolean) => void;
}

/**
 * Chuỗi Auto Flash Sale của một đợt: bật/tắt Auto, đợt trước / đợt sau, và cả chuỗi A → B → C.
 */
export function FlashSaleAutoChainCard({ flashSale, canToggle, toggling, leadHours, onToggle }: FlashSaleAutoChainCardProps) {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const chain = useFlashSaleAutoChain(flashSale.autoChainId ? flashSale.id : undefined);
  const nodes = chain.data?.nodes ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Repeat className="size-4" />
            {t('flashSale.auto.chainTitle')}
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${flashSale.autoMode ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
            >
              {flashSale.autoMode ? t('flashSale.auto.on') : t('flashSale.auto.off')}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">{t('flashSale.auto.chainHint', { hours: leadHours })}</p>
        </div>
        {canToggle && flashSale.status !== 'CANCELLED' && (
          <Button variant="outline" size="sm" disabled={toggling} onClick={() => onToggle(!flashSale.autoMode)}>
            {toggling && <Loader2 className="size-4 animate-spin" />}
            {flashSale.autoMode ? t('flashSale.auto.turnOff') : t('flashSale.auto.turnOn')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!flashSale.autoChainId ? (
          <p className="text-sm text-muted-foreground">{t('flashSale.auto.chainEmpty')}</p>
        ) : chain.isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <ol className="space-y-1.5 text-sm">
            {nodes.map((node) => {
              const current = node.id === flashSale.id;
              return (
                <li key={node.id} className="flex flex-wrap items-center gap-2">
                  <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                    {node.autoSequence ? t('flashSale.auto.sequence', { n: node.autoSequence }) : ''}
                  </span>
                  {current ? (
                    <span className="font-semibold">
                      {node.name} ({t('flashSale.auto.thisSale')})
                    </span>
                  ) : (
                    <Link href={`/dashboard/pod/flash-sales/${node.id}`} className="font-medium hover:underline">
                      {node.name}
                    </Link>
                  )}
                  <ListingStatusBadge status={node.status} label={t(`flashSale.status.${node.status}`)} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(node.startAt)} → {formatDateTime(node.endAt)}
                  </span>
                  {node.id === chain.data?.previousId && (
                    <span className="text-xs text-muted-foreground">· {t('flashSale.auto.createdFrom')}</span>
                  )}
                  {node.id === chain.data?.nextId && (
                    <span className="text-xs text-muted-foreground">· {t('flashSale.auto.next')}</span>
                  )}
                  {node.autoMode && (
                    <span className="text-xs font-medium text-emerald-600">· {t('flashSale.auto.activeNode')}</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
