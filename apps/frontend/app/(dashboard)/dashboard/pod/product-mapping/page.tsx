'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
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
import { useApiError } from '@/hooks/use-api-error';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { MappingFormDialog } from '@/features/fulfillment/components/mapping-form-dialog';
import {
  useFulfillmentProviderOptions,
  useProductMappingActions,
  useProductMappings,
} from '@/features/fulfillment/hooks/use-fulfillment';
import type {
  ProductMapping,
  ProductMappingQuery,
  UpsertProductMappingInput,
} from '@/features/fulfillment/types';

export default function ProductMappingPage() {
  const { t } = useTranslation('fulfillment');
  return (
    <RequirePermission permission="fulfillment.config" message={t('mapping.noPermission')}>
      <MappingView />
    </RequirePermission>
  );
}

function MappingView() {
  const { t } = useTranslation(['fulfillment', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();

  const [query, setQuery] = useState<ProductMappingQuery>({ page: 1, limit: 20 });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductMapping | null>(null);
  const [deleting, setDeleting] = useState<ProductMapping | null>(null);

  const providers = useFulfillmentProviderOptions();
  const mappings = useProductMappings(query);
  const actions = useProductMappingActions();

  // Đổi từ khoá ⇒ quay lại trang 1, tránh rơi vào trang trống.
  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  const patchQuery = (patch: Partial<ProductMappingQuery>) =>
    setQuery((prev) => ({ ...prev, ...patch }));

  const items = mappings.data?.items ?? [];
  const meta = mappings.data?.meta;
  const filtered = Boolean(query.search || query.accountId || query.status);

  const handleSubmit = async (accountId: string, input: UpsertProductMappingInput) => {
    try {
      if (editing) {
        await actions.update.mutateAsync({ id: editing.id, input });
        toast.success(t('mapping.updateSuccess'));
      } else {
        await actions.create.mutateAsync(input);
        toast.success(t('mapping.createSuccess'), { description: input.providerSku });
      }
      setFormOpen(false);
      setEditing(null);
    } catch (error) {
      toast.error(t('mapping.createSuccess'), { description: translateApiError(error) });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await actions.remove.mutateAsync(deleting.id);
      toast.success(t('mapping.deleteSuccess'));
      setDeleting(null);
    } catch (error) {
      toast.error(t('mapping.deleteSuccess'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('mapping.pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('mapping.pageSubtitle')}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t('mapping.add')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('mapping.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Combobox
              value={query.accountId ?? ''}
              onChange={(value) => patchQuery({ accountId: value || undefined, page: 1 })}
              options={[
                { value: '', label: t('mapping.allProviders') },
                ...(providers.data ?? []).map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                })),
              ]}
              className="w-[200px]"
            />
            <Combobox
              value={query.status ?? ''}
              onChange={(value) =>
                patchQuery({
                  status: (value || undefined) as ProductMappingQuery['status'],
                  page: 1,
                })
              }
              options={[
                { value: '', label: t('common:filter.allStatuses') },
                { value: 'ACTIVE', label: t('mapping.statusValue.ACTIVE') },
                { value: 'INACTIVE', label: t('mapping.statusValue.INACTIVE') },
              ]}
              className="w-[170px]"
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {mappings.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : mappings.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(mappings.error)}
            </p>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {filtered ? t('mapping.emptyFiltered') : t('mapping.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('mapping.tiktokProduct')}</TableHead>
                    <TableHead>{t('mapping.sellerSku')}</TableHead>
                    <TableHead>{t('mapping.provider')}</TableHead>
                    <TableHead>{t('mapping.providerProduct')}</TableHead>
                    <TableHead>{t('mapping.variant')}</TableHead>
                    <TableHead>{t('mapping.providerSku')}</TableHead>
                    <TableHead>{t('mapping.status')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('mapping.updatedAt')}</TableHead>
                    <TableHead className="text-right">{t('common:table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">
                        {mapping.tiktokSkuId ?? mapping.tiktokProductId ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-xs">
                        {mapping.sellerSku ?? '—'}
                      </TableCell>
                      <TableCell>{mapping.providerName ?? '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {mapping.providerProductName ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        {mapping.providerVariantName ??
                          ([mapping.providerColor, mapping.providerSize]
                            .filter(Boolean)
                            .join(' / ') ||
                            '—')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{mapping.providerSku}</TableCell>
                      <TableCell>
                        <Badge variant={mapping.isActive ? 'success' : 'muted'}>
                          {t(`mapping.statusValue.${mapping.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(mapping.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common:action.edit')}
                            onClick={() => {
                              setEditing(mapping);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('common:action.delete')}
                            onClick={() => setDeleting(mapping)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {meta && meta.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t('common:pagination.pageWithTotal', {
                  page: meta.page,
                  totalPages: meta.totalPages,
                  total: meta.total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => patchQuery({ page: meta.page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                  {t('common:action.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => patchQuery({ page: meta.page + 1 })}
                >
                  {t('common:action.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <MappingFormDialog
        open={formOpen}
        mapping={editing}
        submitting={actions.create.isPending || actions.update.isPending}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={(accountId, input) => void handleSubmit(accountId, input)}
        onRefreshCatalog={(accountId) => void actions.refreshCatalog.mutateAsync(accountId)}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('mapping.deleteTitle')}
        description={t('mapping.deleteDescription', {
          sku: deleting?.sellerSku ?? deleting?.providerSku ?? '',
        })}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            {t('common:action.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={actions.remove.isPending}
            onClick={() => void handleDelete()}
          >
            {actions.remove.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.delete')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
