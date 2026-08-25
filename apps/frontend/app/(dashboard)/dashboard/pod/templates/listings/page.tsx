'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
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
import { ListingTemplateDialog } from '@/features/pod-listing/components/listing-template-dialog';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { TemplateTransferBar } from '@/features/pod-listing/components/template-transfer-bar';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import {
  POD_LISTING_MARKETS,
  type PodListingMarket,
  type PodListingTemplate,
} from '@/features/pod-listing/types';

export default function ListingTemplatesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <ListingTemplatesView />
    </RequirePermission>
  );
}

/**
 * **POD → Templates → Listing Templates** — template lớn nhất.
 *
 * Mỗi dòng cho thấy đủ năm mảnh đã ghép, nên nhìn bảng là biết template nào còn thiếu
 * thành phần — thiếu mảnh nào thì listing sinh ra sẽ báo lỗi ở đúng mảnh đó.
 */
function ListingTemplatesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodListingTemplate>('listings', { withMarket: true });
  const [editing, setEditing] = useState<PodListingTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <TemplatePageShell
        title={t('listing.listingTemplates.title')}
        subtitle={t('listing.listingTemplates.subtitle')}
        createLabel={t('listing.listingTemplates.create')}
        onCreate={
          canWrite
            ? () => {
                setEditing(null);
                setDialogOpen(true);
              }
            : undefined
        }
        actions={
          <TemplateTransferBar kind="listings" query={state.query} canExport canImport={canWrite} />
        }
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        emptyMessage={t('listing.listingTemplates.empty')}
        onSearchChange={state.setSearch}
        sort={state.sort}
        status={{ value: state.status, onChange: state.setStatus }}
        filters={
          <Combobox
            value={state.market}
            onChange={(value) => state.setMarket(value as PodListingMarket | '')}
            options={[
              { value: '', label: t('listing.filters.allMarkets') },
              ...POD_LISTING_MARKETS.map((market) => ({ value: market, label: market })),
            ]}
            className="w-[150px]"
          />
        }
        meta={state.meta}
        onPageChange={state.setPage}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.common.name')}</TableHead>
              <TableHead>{t('listing.common.market')}</TableHead>
              <TableHead>{t('listing.listingTemplates.composition')}</TableHead>
              <TableHead>{t('listing.scope.column')}</TableHead>
              <TableHead>{t('listing.listingTemplates.warehouse')}</TableHead>
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
                <TableCell>
                  <Badge variant="muted">{item.market}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Part label={t('listing.tabs.categories')} value={item.categoryTemplate?.name} />
                    <Part label={t('listing.tabs.skus')} value={item.skuTemplate?.name} />
                    <Part
                      label={t('listing.tabs.descriptions')}
                      value={item.descriptionTemplate?.name}
                    />
                    <Part label={t('listing.tabs.images')} value={item.imageTemplate?.name} />
                    <Part label={t('listing.tabs.pricing')} value={item.pricingStrategy?.name} />
                  </div>
                </TableCell>
                <TableCell>
                  {(item.scopes ?? []).length === 0 ? (
                    <Badge variant="warning">{t('listing.scope.none')}</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {item.scopes.slice(0, 3).map((scope, index) => (
                        <Badge key={index} variant={scope.isExclude ? 'destructive' : 'muted'}>
                          {scope.isExclude ? '−' : '+'} {t(`listing.scope.match.${scope.matchType}`)}
                          {scope.valueLabel ? `: ${scope.valueLabel}` : ''}
                        </Badge>
                      ))}
                      {item.scopes.length > 3 && (
                        <Badge variant="muted">+{item.scopes.length - 3}</Badge>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm">{item.warehouse?.name ?? '—'}</TableCell>
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

      <ListingTemplateDialog
        open={dialogOpen}
        template={editing}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

/** Một mảnh của template — thiếu thì hiện xám để nhìn phát thấy ngay. */
function Part({ label, value }: { label: string; value?: string | null }) {
  return (
    <Badge variant={value ? 'default' : 'muted'} className="whitespace-nowrap">
      {label}: {value ?? '—'}
    </Badge>
  );
}
