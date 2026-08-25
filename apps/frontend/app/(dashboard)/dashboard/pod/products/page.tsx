'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, History, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ProductSyncHistoryDialog } from '@/features/pod-product/components/product-sync-history-dialog';
import { ProductTable } from '@/features/pod-product/components/product-table';
import {
  usePodProductFilters,
  usePodProducts,
  useSyncPodProducts,
} from '@/features/pod-product/hooks/use-pod-products';
import type { PodProductQuery } from '@/features/pod-product/types';

export default function PodProductsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.product.read" message={t('products.noPermission')}>
      <PodProductsView />
    </RequirePermission>
  );
}

/**
 * Màn hình **POD → Products**.
 *
 * Sản phẩm ở đây là BẢN SAO đọc từ TikTok Shop (Sprint 2 chỉ đồng bộ một chiều) — vì vậy
 * không có nút Tạo/Sửa/Xoá. Muốn đổi sản phẩm, seller đổi trên Seller Center rồi bấm
 * "Sync Now" để kéo về.
 */
function PodProductsView() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.product.sync');

  const [query, setQuery] = useState<PodProductQuery>({
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [historyOpen, setHistoryOpen] = useState(false);

  const productsQuery = usePodProducts(query);
  const filtersQuery = usePodProductFilters();
  const syncMutation = useSyncPodProducts();

  const patchQuery = (patch: Partial<PodProductQuery>) =>
    setQuery((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  const items = productsQuery.data?.items ?? [];
  const meta = productsQuery.data?.meta;
  const filters = filtersQuery.data;

  const handleSync = async (full: boolean) => {
    try {
      const result = await syncMutation.mutateAsync({
        shopId: query.shopId,
        full,
        // Lần quét toàn bộ cũng làm mới danh mục + thương hiệu để bộ lọc đầy đủ ngay.
        includeCatalog: full,
      });
      toast.success(t('products.sync.success'), {
        description: t('products.sync.successDetail', {
          fetched: result.productsFetched,
          created: result.productsCreated,
          updated: result.productsUpdated,
          failed: result.productsFailed,
        }),
      });
    } catch (error) {
      toast.error(t('products.sync.failed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('products.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('products.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <History className="size-4" />
            {t('products.syncHistory.action')}
          </Button>
          {canSync && (
            <>
              <Button
                variant="outline"
                onClick={() => void handleSync(true)}
                disabled={syncMutation.isPending}
                title={t('products.sync.fullHint')}
              >
                {t('products.sync.full')}
              </Button>
              <Button onClick={() => void handleSync(false)} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t('products.sync.now')}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t('products.searchPlaceholder')}
                className="pl-9"
              />
            </div>

            <Combobox
              value={query.shopId ?? ''}
              onChange={(value) => patchQuery({ shopId: value || undefined })}
              options={[
                { value: '', label: t('products.filters.allShops') },
                ...(filters?.shops ?? []).map((shop) => ({
                  value: shop.id,
                  label: shop.name,
                })),
              ]}
              className="w-[190px]"
            />

            <Combobox
              value={query.status ?? ''}
              onChange={(value) => patchQuery({ status: value || undefined })}
              options={[
                { value: '', label: t('common:filter.allStatuses') },
                ...(filters?.statuses ?? []).map((status) => ({ value: status, label: status })),
              ]}
              className="w-[170px]"
            />

            <Combobox
              value={query.categoryId ?? ''}
              onChange={(value) => patchQuery({ categoryId: value || undefined })}
              options={[
                { value: '', label: t('products.filters.allCategories') },
                ...(filters?.categories ?? []).map((category) => ({
                  value: category.id,
                  label: category.name,
                })),
              ]}
              className="w-[220px]"
            />

            <Combobox
              value={query.brandId ?? ''}
              onChange={(value) => patchQuery({ brandId: value || undefined })}
              options={[
                { value: '', label: t('products.filters.allBrands') },
                ...(filters?.brands ?? []).map((brand) => ({
                  value: brand.id,
                  label: brand.name,
                })),
              ]}
              className="w-[180px]"
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {productsQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(productsQuery.error)}
            </p>
          ) : (
            <ProductTable products={items} loading={productsQuery.isLoading} />
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
                  onClick={() => setQuery((prev) => ({ ...prev, page: meta.page - 1 }))}
                >
                  <ChevronLeft className="size-4" />
                  {t('common:action.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setQuery((prev) => ({ ...prev, page: meta.page + 1 }))}
                >
                  {t('common:action.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ProductSyncHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
