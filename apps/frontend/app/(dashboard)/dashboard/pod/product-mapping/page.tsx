'use client';

import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
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
import { MappingDesignCell } from '@/features/fulfillment/components/mapping-design-cell';
import { MappingDesignDialog } from '@/features/fulfillment/components/mapping-design-dialog';
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
  const { formatDateTime, formatCurrency } = useLocaleFormat();

  const [query, setQuery] = useState<ProductMappingQuery>({ page: 1, limit: 20 });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductMapping | null>(null);
  const [deleting, setDeleting] = useState<ProductMapping | null>(null);
  const [designing, setDesigning] = useState<ProductMapping | null>(null);

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
  const filtered = Boolean(
    query.search || query.accountId || query.status || query.designStatus,
  );

  // 🔴 Đọc lại bản ghi từ danh sách vừa tải, KHÔNG dùng bản đã lưu trong state: upload/xoá
  // design làm mới cache, và dialog phải thấy ảnh mới ngay — nếu giữ bản chụp cũ thì người
  // dùng thay design xong vẫn nhìn thấy file cũ cho tới khi đóng mở lại dialog.
  const designingLive = designing
    ? (items.find((item) => item.id === designing.id) ?? designing)
    : null;

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

  /**
   * Kéo danh mục nhà cung cấp về Database.
   *
   * Đây là tác vụ DÀI (hàng nghìn lời gọi API), nên phải báo kết quả cụ thể chứ không chỉ
   * "thành công": `complete = false` nghĩa là đọc thiếu, và người vận hành cần biết để chạy
   * lại thay vì tin rằng danh mục đã đầy đủ.
   */
  const handleSyncCatalog = async (accountId: string) => {
    try {
      const result = await actions.syncCatalog.mutateAsync(accountId);
      const description = t('mapping.syncCatalogSummary', {
        catalogues: result.catalogues,
        products: result.products,
        variants: result.variants,
      });
      if (result.complete) {
        toast.success(t('mapping.syncCatalogSuccess'), { description });
      } else {
        toast.warning(t('mapping.syncCatalogPartial'), {
          description: `${description} — ${result.warnings[0] ?? ''}`,
        });
      }
    } catch (error) {
      toast.error(t('mapping.syncCatalogFailed'), { description: translateApiError(error) });
    }
  };

  /** Rà ánh xạ tự động cho mọi sản phẩm chưa ánh xạ. */
  const handleAutoResolve = async () => {
    try {
      const result = await actions.autoResolve.mutateAsync();
      toast.success(t('mapping.autoResolveDone'), {
        description: t('mapping.autoResolveSummary', {
          autoMapped: result.autoMapped,
          needManual: result.needManual,
          notFound: result.notFound,
        }),
      });
    } catch (error) {
      toast.error(t('mapping.autoResolveFailed'), { description: translateApiError(error) });
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
        <div className="flex flex-wrap gap-2">
          {/* Rà ánh xạ tự động — đường ngắn nhất để xử lý hàng loạt sản phẩm chưa ánh xạ. */}
          <Button
            variant="outline"
            disabled={actions.autoResolve.isPending}
            onClick={() => void handleAutoResolve()}
          >
            {actions.autoResolve.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('mapping.autoResolve')}
          </Button>
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
            {/* Lọc "chưa có design" — đường ngắn nhất từ "đơn không gửi được" tới việc cần làm. */}
            <Combobox
              value={query.designStatus ?? ''}
              onChange={(value) =>
                patchQuery({
                  designStatus: (value || undefined) as ProductMappingQuery['designStatus'],
                  page: 1,
                })
              }
              options={[
                { value: '', label: t('mapping.allDesignStatuses') },
                { value: 'READY', label: t('mapping.designFilter.READY') },
                { value: 'MISSING', label: t('mapping.designFilter.MISSING') },
              ]}
              className="w-[190px]"
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
                  {/* Thứ tự cột theo đúng thứ tự người dùng cần: KHOÁ (Product ID + Seller
                      SKU) → nơi sản xuất (Provider + Fulfillment SKU) → thứ phải chuẩn bị
                      (Design) → tiền (Base Cost) → dấu vết (ai sửa, lúc nào). */}
                  <TableRow>
                    <TableHead>{t('mapping.tiktokProductId')}</TableHead>
                    <TableHead>{t('mapping.sellerSku')}</TableHead>
                    <TableHead>{t('mapping.provider')}</TableHead>
                    <TableHead>{t('mapping.providerSku')}</TableHead>
                    <TableHead>{t('mapping.design')}</TableHead>
                    <TableHead className="text-right">{t('mapping.baseCost')}</TableHead>
                    <TableHead>{t('mapping.status')}</TableHead>
                    <TableHead>{t('mapping.updatedBy')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('mapping.updatedAt')}</TableHead>
                    <TableHead className="text-right">{t('common:table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">
                        {mapping.tiktokProductId ?? (
                          /* Bản ghi cũ thiếu khoá: không ghép được đơn nào, nói thẳng ra
                             thay vì hiện dấu gạch ngang trông như "không có thì thôi". */
                          <span className="font-sans text-destructive">
                            {t('mapping.keyIncomplete')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-xs">
                        {mapping.sellerSku ?? (
                          <span className="font-sans text-destructive">
                            {t('mapping.keyIncomplete')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="block">{mapping.providerName ?? '—'}</span>
                        <span className="block max-w-[180px] truncate text-xs text-muted-foreground">
                          {mapping.providerVariantName ??
                            [mapping.providerColor, mapping.providerSize]
                              .filter(Boolean)
                              .join(' / ')}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{mapping.providerSku}</TableCell>
                      <TableCell>
                        <MappingDesignCell
                          mapping={mapping}
                          onManage={() => setDesigning(mapping)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs">
                        {mapping.baseCost === null ? '—' : formatCurrency(mapping.baseCost, 'USD')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={mapping.isActive ? 'success' : 'muted'}>
                          {t(`mapping.statusValue.${mapping.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-muted-foreground">
                        {mapping.updatedByName ?? '—'}
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
        onSyncCatalog={(accountId) => void handleSyncCatalog(accountId)}
        syncingCatalog={actions.syncCatalog.isPending}
      />

      <MappingDesignDialog
        open={Boolean(designingLive)}
        mapping={designingLive}
        onClose={() => setDesigning(null)}
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
