'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, History, Loader2, PauseCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { shopOptionLabel } from '@/features/pod-tiktok/shop-label';
import { DataPagination } from '@/components/ui/data-pagination';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useClampedPage } from '@/hooks/use-clamped-page';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ImageLightbox } from '@/features/pod-tiktok/components/image-lightbox';
import { ProductSyncHistoryDialog } from '@/features/pod-product/components/product-sync-history-dialog';
import { EditProductDialog } from '@/features/pod-product/components/edit-product-dialog';
import { CloneProductDialog } from '@/features/pod-product/components/clone-product-dialog';
import {
  ProductActionConfirmDialog,
  type ProductLifecycleAction,
} from '@/features/pod-product/components/product-action-confirm-dialog';
import { ProductTable } from '@/features/pod-product/components/product-table';
import {
  useDeactivatePodProduct,
  useDeletePodProduct,
  usePodProductFilters,
  usePodProducts,
  useSyncPodProducts,
} from '@/features/pod-product/hooks/use-pod-products';
import type { ProductGalleryImage } from '@/features/pod-product/product-images';
import type { PodProductListItem, PodProductQuery } from '@/features/pod-product/types';

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
 * Sản phẩm ở đây là bản sao đọc từ TikTok Shop. Mọi thao tác ghi đều đi NGƯỢC LÊN SÀN trước,
 * sàn nhận mới đổi dữ liệu ở đây:
 *   - **Sửa** — Partial Edit Product rồi đồng bộ lại (`EditProductDialog`).
 *   - **Ngừng bán** / **Xoá** — Deactivate / Delete Products, có hộp xác nhận, chạy được
 *     hàng loạt trên các dòng đã tick (tuần tự từng sản phẩm, kết quả gộp vào một toast).
 *   - **Nhân bản sản phẩm** — ĐÚNG MỘT sản phẩm nguồn → NHIỀU shop đích (`CloneProductDialog`):
 *     backend tạo Listing Job type CLONE, dialog theo dõi kết quả từng shop.
 */
function PodProductsView() {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.product.sync');
  // 🔴 Chỉ để ẩn/hiện nút. Backend kiểm lại quyền này ở MỖI request PATCH — ẩn nút không
  // phải là biện pháp bảo vệ, nó chỉ tránh mời người dùng bấm một thứ chắc chắn bị từ chối.
  const canEdit = hasPermission('pod.product.update');
  const canDeactivate = hasPermission('pod.product.deactivate');
  const canDelete = hasPermission('pod.product.delete');
  const canClone = hasPermission('pod.product.clone');

  const [query, setQuery] = useState<PodProductQuery>({
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Sản phẩm đang mở ở màn hình sửa. `null` = đóng. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Hộp xác nhận Ngừng bán / Xoá — một hoặc nhiều sản phẩm. `null` = đóng. */
  const [confirm, setConfirm] = useState<{
    action: ProductLifecycleAction;
    products: PodProductListItem[];
  } | null>(null);
  /** Tiến độ của lượt hàng loạt đang chạy — hiện trên nút xác nhận. */
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  /** Sản phẩm NGUỒN đang mở dialog nhân bản. `null` = đóng. */
  const [cloning, setCloning] = useState<PodProductListItem | null>(null);
  /**
   * Các dòng đang được tick ở bảng.
   *
   * 🔴 Đặt ở TRANG chứ không trong `ProductTable`: lựa chọn phải sống sót qua mỗi lần bảng
   * render lại (lật trang, đổi bộ lọc trả về cùng một sản phẩm), nhưng phải bị xoá khi điều
   * kiện truy vấn đổi — xem `useEffect` bên dưới. State nằm trong bảng thì không làm được
   * cả hai, và mọi hành động hàng loạt sau này cũng cần đọc nó từ đây.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /**
   * Bộ ảnh đang xem — MỘT lightbox dùng chung cho cả bảng.
   *
   * 🔴 Đặt ở trang, không đặt trong từng ô ảnh: 20 dòng × 4 thumbnail mà mỗi cái một modal là
   * 80 modal nằm sẵn trong DOM. Ở đây chỉ có đúng một, và nó chỉ render khi `open`.
   *
   * 🔴 State này KHÔNG đụng tới `query`, nên mở/đóng bộ xem không hề ảnh hưởng trang hiện
   * tại, từ khoá tìm kiếm hay bộ lọc — react-query cũng không phải tải lại gì.
   */
  const [lightbox, setLightbox] = useState<{
    images: ProductGalleryImage[];
    index: number;
    alt: string;
  } | null>(null);

  // `useCallback` để `ProductTable` không nhận một hàm mới ở mỗi lần render của trang.
  const openLightbox = useCallback(
    (images: ProductGalleryImage[], index: number, alt: string) =>
      setLightbox({ images, index, alt }),
    [],
  );

  const productsQuery = usePodProducts(query);
  const filtersQuery = usePodProductFilters();
  const syncMutation = useSyncPodProducts();
  const deactivateMutation = useDeactivatePodProduct();
  const deleteMutation = useDeletePodProduct();

  const patchQuery = (patch: Partial<PodProductQuery>) =>
    setQuery((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  // Đổi trang/bộ lọc ⇒ bỏ chọn. Giữ lại các ID không còn hiển thị là một con số "đã chọn N"
  // mà người dùng không có cách nào nhìn thấy N cái đó là gì.
  useEffect(() => {
    // Giữ nguyên mảng cũ khi đã rỗng — tránh một lượt render thừa ở lần mount đầu tiên.
    setSelectedIds((prev) => (prev.length === 0 ? prev : []));
  }, [query]);

  const items = productsQuery.data?.items ?? [];
  const meta = productsQuery.data?.meta;
  // Lựa chọn chỉ sống trong trang hiện tại (xoá khi đổi trang/bộ lọc), nên tra ngay trong `items`.
  const selectedProducts = items.filter((product) => selectedIds.includes(product.id));
  // Xoá nốt record cuối của trang cuối ⇒ lùi về trang còn dữ liệu,
  // không để giao diện kẹt ở "Trang 3 / 2" với một cái bảng trống.
  useClampedPage(meta, (next) => setQuery((prev) => ({ ...prev, page: next })));
  const filters = filtersQuery.data;

  const handleSync = async (full: boolean) => {
    try {
      const result = await syncMutation.mutateAsync({ shopId: query.shopId, full });

      // 🔴 Có shop hỏng thì KHÔNG báo thành công. Trước đây backend nuốt lỗi theo shop nên
      // một lượt hỏng sạch vì token hết hạn vẫn hiện "Đồng bộ thành công · 0 sản phẩm".
      if (result.shopsFailed > 0) {
        const detail = result.errors
          .map((item) =>
            [item.shopName, item.errorCode, item.errorMessage].filter(Boolean).join(' · '),
          )
          .join(' | ');
        const notify = result.shopsFailed === result.shopsProcessed ? toast.error : toast.warning;
        notify(t('products.sync.failed'), { description: detail || undefined });
        return;
      }

      // Shop đang bận (đã có lượt khác chạy) không phải lỗi, nhưng cũng không phải thành
      // công — báo đúng như vậy thay vì hiện "0 sản phẩm" không rõ lý do.
      if (result.shopsBusy > 0 && result.shopsBusy === result.shopsProcessed) {
        toast.warning(t('products.sync.busy'));
        return;
      }

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

  /**
   * Chạy Ngừng bán / Xoá cho danh sách trong hộp xác nhận — TUẦN TỰ từng sản phẩm.
   *
   * 🔴 Tuần tự có chủ ý: mỗi lời gọi là một request TikTok + (với ngừng bán) một lượt đồng bộ
   * lại; bắn 20 request song song là tự đụng rate limit. Một sản phẩm hỏng KHÔNG dừng những
   * sản phẩm còn lại — kết quả gộp thành một toast, lỗi từng sản phẩm liệt kê trong mô tả.
   * Sản phẩm hỏng vẫn được giữ trong lựa chọn để người dùng thử lại; sản phẩm xong thì bỏ tick.
   */
  const runLifecycle = async () => {
    if (!confirm || bulkProgress) return;
    const { action, products } = confirm;
    const mutation = action === 'DEACTIVATE' ? deactivateMutation : deleteMutation;
    const failures: string[] = [];
    const succeeded: string[] = [];
    setBulkProgress({ done: 0, total: products.length });

    for (const [index, product] of products.entries()) {
      try {
        await mutation.mutateAsync(product.id);
        succeeded.push(product.id);
      } catch (error) {
        failures.push(
          `${product.title?.trim() || product.tiktokProductId}: ${translateApiError(error)}`,
        );
      }
      setBulkProgress({ done: index + 1, total: products.length });
    }

    setBulkProgress(null);
    setConfirm(null);
    setSelectedIds((prev) => prev.filter((id) => !succeeded.includes(id)));

    const scope = action === 'DEACTIVATE' ? 'deactivate' : 'delete';
    if (failures.length === 0) {
      toast.success(t(`products.${scope}.success`, { count: succeeded.length }));
    } else if (succeeded.length === 0) {
      toast.error(t(`products.${scope}.failed`, { count: failures.length }), {
        description: failures.join(' | '),
      });
    } else {
      toast.warning(
        t('products.bulk.partial', { success: succeeded.length, failed: failures.length }),
        { description: failures.join(' | ') },
      );
    }
  };

  /** "Nhân bản" đòi ĐÚNG MỘT sản phẩm nguồn — nhiều hơn thì báo, không đoán. */
  const openCloneFromSelection = () => {
    if (selectedProducts.length !== 1) {
      toast.error(t('products.clone.onlyOne'));
      return;
    }
    setCloning(selectedProducts[0]);
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
                  // Nhãn = Connection Name; `value` vẫn là `shop.id` như cũ.
                  label: shopOptionLabel(shop),
                })),
              ]}
              className="w-[190px]"
            />

            {/* 🔴 Bộ lọc Trạng thái đã bị GỠ. Hệ thống nay chỉ quản lý sản phẩm ĐANG BÁN
                (ACTIVATE), nên ô này chỉ còn đúng một giá trị để chọn — một điều khiển
                không thay đổi được gì thì chỉ làm người dùng mất thời gian thử. Sản phẩm
                ngừng bán vẫn nằm trong database (phục vụ ánh xạ / đơn cũ) và đọc được qua
                `GET /pod/products?includeInactive=true`. */}

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
            <>
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <span className="mr-1">{t('products.selection.count', { count: selectedIds.length })}</span>
                  {canClone && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openCloneFromSelection}
                      // Vẫn bấm được khi chọn nhiều để nhận thông báo "chỉ chọn một" — nút
                      // chết lặng không nói cho người dùng biết vì sao.
                      title={selectedProducts.length === 1 ? undefined : t('products.clone.onlyOne')}
                      className={selectedProducts.length === 1 ? undefined : 'opacity-60'}
                    >
                      <Copy className="size-3.5" />
                      {t('products.actions.clone')}
                    </Button>
                  )}
                  {canDeactivate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirm({ action: 'DEACTIVATE', products: selectedProducts })}
                    >
                      <PauseCircle className="size-3.5" />
                      {t('products.actions.deactivate')}
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirm({ action: 'DELETE', products: selectedProducts })}
                    >
                      <Trash2 className="size-3.5" />
                      {t('products.actions.delete')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                    {t('products.selection.clear')}
                  </Button>
                </div>
              )}
              <ProductTable
                products={items}
                loading={productsQuery.isLoading}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onOpenImages={openLightbox}
                onEdit={canEdit ? setEditingId : undefined}
                onClone={canClone ? setCloning : undefined}
                onDeactivate={
                  canDeactivate
                    ? (product) => setConfirm({ action: 'DEACTIVATE', products: [product] })
                    : undefined
                }
                onDelete={
                  canDelete ? (product) => setConfirm({ action: 'DELETE', products: [product] }) : undefined
                }
              />
            </>
          )}

          <DataPagination
            meta={meta}
            onPageChange={(next) => setQuery((prev) => ({ ...prev, page: next }))}
            onPageSizeChange={(next) => setQuery((prev) => ({ ...prev, limit: next, page: 1 }))}
          />
        </CardContent>
      </Card>

      <ProductSyncHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />

      {/* Chỉ gắn vào cây khi thật sự mở: modal tự tải chi tiết sản phẩm, và giữ nó trong DOM
          ở trạng thái đóng nghĩa là mỗi lần bảng render lại đều kéo theo nó. */}
      {editingId && (
        <EditProductDialog
          open
          productId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}

      {confirm && (
        <ProductActionConfirmDialog
          open
          action={confirm.action}
          products={confirm.products}
          loading={bulkProgress !== null}
          progress={bulkProgress}
          onConfirm={() => void runLifecycle()}
          onClose={() => setConfirm(null)}
        />
      )}

      {/* Gắn vào cây khi mở: dialog tự tải danh sách shop và theo dõi lượt chạy bằng polling. */}
      {cloning && (
        <CloneProductDialog
          open
          product={cloning}
          onClose={(hadResult) => {
            setCloning(null);
            // Sản phẩm mới về sau lượt đồng bộ được hẹn — nhưng làm mới ngay để danh sách
            // không giữ ảnh chụp cũ nếu đồng bộ đã kịp chạy.
            if (hadResult) void productsQuery.refetch();
          }}
        />
      )}

      {/* 🔴 `src` của lightbox là URL ẢNH GỐC (`…-origin-jpeg`), không phải bản thu nhỏ
          300×300 mà bảng đang hiển thị — xem `buildProductGallery`. */}
      <ImageLightbox
        open={Boolean(lightbox)}
        images={lightbox?.images.map((image) => ({ src: image.src, label: lightbox.alt }))}
        startIndex={lightbox?.index ?? 0}
        alt={lightbox?.alt}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
