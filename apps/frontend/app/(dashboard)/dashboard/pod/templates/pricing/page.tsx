'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { PricingStrategyDialog } from '@/features/pod-listing/components/simple-template-dialogs';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { TemplateTransferBar } from '@/features/pod-listing/components/template-transfer-bar';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import type { PodPricingStrategy } from '@/features/pod-listing/types';

export default function PricingStrategiesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <PricingStrategiesView />
    </RequirePermission>
  );
}

/** **POD → Templates → Pricing Strategies** — Cost + Shipping + Markup ⇒ Sale ⇒ Retail ⇒ Discount. */
function PricingStrategiesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodPricingStrategy>('pricing');
  const [editing, setEditing] = useState<PodPricingStrategy | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  /** Cột "cách tính": FORMULA hiện luôn biểu thức, hai kiểu kia hiện con số. */
  const markupOf = (item: PodPricingStrategy): string =>
    item.markupType === 'FORMULA'
      ? (item.formula ?? '—')
      : `${item.markupType} ${item.markupValue}`;

  return (
    <>
      <TemplatePageShell
        title={t('listing.pricing.title')}
        subtitle={t('listing.pricing.subtitle')}
        createLabel={t('listing.pricing.create')}
        onCreate={
          canWrite
            ? () => {
                setEditing(null);
                setDialogOpen(true);
              }
            : undefined
        }
        actions={
          <TemplateTransferBar kind="pricing" query={state.query} canExport canImport={canWrite} />
        }
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        emptyMessage={t('listing.pricing.empty')}
        onSearchChange={state.setSearch}
        sort={state.sort}
        status={{ value: state.status, onChange: state.setStatus }}
        meta={state.meta}
        onPageChange={state.setPage}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.common.name')}</TableHead>
              <TableHead>{t('listing.pricing.cost')}</TableHead>
              <TableHead>{t('listing.pricing.markupType')}</TableHead>
              <TableHead>{t('listing.pricing.retailMultiplier')}</TableHead>
              <TableHead>{t('listing.pricing.discount')}</TableHead>
              <TableHead>{t('listing.common.currency')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.isDefault && <Badge variant="success">{t('listing.common.default')}</Badge>}
                    {!item.isActive && <Badge variant="muted">{t('listing.common.off')}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {item.cost} + {item.shippingCost}
                </TableCell>
                <TableCell className="max-w-[260px] truncate font-mono text-xs">
                  {markupOf(item)}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  ×{item.retailPriceMultiplier}
                </TableCell>
                <TableCell className="text-sm tabular-nums">{item.discountPercent}%</TableCell>
                <TableCell className="text-sm">{item.currency}</TableCell>
                <TableCell>
                  <TemplateRowActions
                    onEdit={
                      canWrite
                        ? () => {
                            setEditing(item);
                            setDialogOpen(true);
                          }
                        : undefined
                    }
                    onClone={canWrite ? () => void state.handleClone(item) : undefined}
                    onDelete={canWrite ? () => void state.handleDelete(item) : undefined}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TemplatePageShell>

      <PricingStrategyDialog
        open={dialogOpen}
        strategy={editing}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
