'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import {
  useFulfillmentProviderOptions,
  useProviderCatalogProducts,
  useProviderCatalogVariations,
  useTiktokProductOptions,
} from '../hooks/use-fulfillment';
import type {
  ProductMapping,
  TiktokProductOption,
  UpsertProductMappingInput,
} from '../types';

interface MappingFormDialogProps {
  open: boolean;
  /** Bỏ trống = tạo mới. */
  mapping?: ProductMapping | null;
  /**
   * Ánh xạ nhanh từ Order Detail: khoá sẵn SKU TikTok, bỏ qua bước chọn sản phẩm TikTok.
   * Người dùng không phải rời màn hình đơn để đi tìm đúng dòng hàng.
   */
  presetTiktok?: TiktokProductOption | null;
  /** Nhà cung cấp gán sẵn (từ TikTok Account của đơn) — cũng khoá luôn bước 1. */
  presetAccountId?: string | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (accountId: string, input: UpsertProductMappingInput) => void;
  onRefreshCatalog?: (accountId: string) => void;
}

/**
 * Dialog tạo/sửa ánh xạ theo đúng 5 bước của quy trình:
 * nhà cung cấp → sản phẩm TikTok → sản phẩm nhà cung cấp → biến thể → lưu.
 *
 * 🔴 Không có sản phẩm hay SKU nào được viết cứng: danh sách TikTok lấy từ đơn đã đồng bộ,
 * danh mục nhà cung cấp đọc trực tiếp qua API (backend cache 5 phút).
 */
export function MappingFormDialog({
  open,
  mapping,
  presetTiktok,
  presetAccountId,
  submitting,
  onClose,
  onSubmit,
  onRefreshCatalog,
}: MappingFormDialogProps) {
  const { t } = useTranslation(['fulfillment', 'common']);
  const isEdit = Boolean(mapping);

  const [accountId, setAccountId] = useState('');
  const [tiktok, setTiktok] = useState<TiktokProductOption | null>(null);
  const [tiktokSearch, setTiktokSearch] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [variantSearch, setVariantSearch] = useState('');

  const debouncedTiktokSearch = useDebouncedValue(tiktokSearch, 350);
  const debouncedCatalogSearch = useDebouncedValue(catalogSearch, 350);

  const providers = useFulfillmentProviderOptions(open);
  const tiktokProducts = useTiktokProductOptions(
    open && !presetTiktok ? accountId || undefined : undefined,
    debouncedTiktokSearch || undefined,
  );
  const catalogProducts = useProviderCatalogProducts(
    open ? accountId || undefined : undefined,
    debouncedCatalogSearch || undefined,
  );
  const variations = useProviderCatalogVariations(
    open ? accountId || undefined : undefined,
    productId || undefined,
  );

  // Mỗi lần mở lại phải dựng lại từ dữ liệu truyền vào — tránh mang lựa chọn cũ sang bản ghi khác.
  useEffect(() => {
    if (!open) return;
    setAccountId(presetAccountId ?? '');
    setTiktok(presetTiktok ?? null);
    setProductId(mapping?.providerProductId ?? '');
    setVariantId(mapping?.providerVariantId ?? '');
    setTiktokSearch('');
    setCatalogSearch('');
    setVariantSearch('');
  }, [open, mapping, presetTiktok, presetAccountId]);

  /**
   * Lọc biến thể NGAY TẠI CHỖ: danh sách đã tải đầy đủ mọi trang nên không cần gọi lại API,
   * và gõ tới đâu lọc tới đó (không có độ trễ mạng).
   * Tìm đồng thời theo tên, SKU, màu và size — bốn thứ người dùng thực sự gõ.
   */
  const filteredVariations = useMemo(() => {
    const items = variations.data ?? [];
    const keyword = variantSearch.trim().toLowerCase();
    if (!keyword) return items;

    // Nhiều từ khoá cách nhau bởi khoảng trắng phải khớp TẤT CẢ (vd "black xl").
    const terms = keyword.split(/\s+/);
    return items.filter((variation) => {
      const haystack = [variation.name, variation.sku, variation.color, variation.size]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [variations.data, variantSearch]);

  const selectedVariant = useMemo(
    () => variations.data?.find((variation) => variation.id === variantId) ?? null,
    [variations.data, variantId],
  );
  const selectedProduct = useMemo(
    () => catalogProducts.data?.find((product) => product.id === productId) ?? null,
    [catalogProducts.data, productId],
  );

  const source = presetTiktok ?? tiktok;
  const canSubmit = Boolean(accountId && source && selectedVariant);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId || !source || !selectedVariant) return;

    onSubmit(accountId, {
      // Giữ CẢ BA khoá khớp để thứ tự ưu tiên lúc gửi đơn hoạt động đúng.
      ...(source.tiktokProductId ? { tiktokProductId: source.tiktokProductId } : {}),
      ...(source.tiktokSkuId ? { tiktokSkuId: source.tiktokSkuId } : {}),
      ...(source.sellerSku ? { sellerSku: source.sellerSku } : {}),
      // SKU biến thể — đây là giá trị THỰC SỰ gửi trong items[].sku khi tạo đơn.
      providerSku: selectedVariant.sku,
      providerProductId: productId,
      providerVariantId: selectedVariant.id,
      ...(selectedProduct?.name ? { providerProductName: selectedProduct.name } : {}),
      providerVariantName: selectedVariant.name,
      ...(selectedVariant.color ? { providerColor: selectedVariant.color } : {}),
      ...(selectedVariant.size ? { providerSize: selectedVariant.size } : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('mapping.edit') : t('mapping.add')}
      className="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Bước 1 — nhà cung cấp */}
        <div className="space-y-2">
          <Label htmlFor="mapping-provider">{t('mapping.step1')}</Label>
          <NativeSelect
            id="mapping-provider"
            value={accountId}
            disabled={Boolean(presetAccountId) || isEdit}
            onChange={(e) => {
              setAccountId(e.target.value);
              // Đổi nhà cung cấp thì danh mục khác hẳn — bỏ lựa chọn cũ.
              setProductId('');
              setVariantId('');
            }}
          >
            <option value="">{t('mapping.selectProviderFirst')}</option>
            {providers.data?.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        {/* Bước 2 — sản phẩm TikTok */}
        <div className="space-y-2">
          <Label>{t('mapping.step2')}</Label>
          {source ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{source.productName ?? source.sellerSku}</p>
              <dl className="mt-1 grid gap-x-4 text-xs text-muted-foreground sm:grid-cols-3">
                <div>
                  <dt className="opacity-70">{t('mapping.sellerSku')}</dt>
                  <dd className="font-mono">{source.sellerSku ?? '—'}</dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('mapping.variant')}</dt>
                  <dd>{source.skuName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('mapping.category')}</dt>
                  <dd>{source.productCategory ?? '—'}</dd>
                </div>
              </dl>
              {!presetTiktok && !isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setTiktok(null)}
                >
                  {t('common:action.reset')}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={tiktokSearch}
                  onChange={(e) => setTiktokSearch(e.target.value)}
                  placeholder={t('mapping.searchTiktok')}
                  className="pl-9"
                  disabled={!accountId}
                />
              </div>
              <PickerList
                loading={tiktokProducts.isLoading}
                empty={(tiktokProducts.data?.length ?? 0) === 0}
                emptyText={accountId ? t('mapping.noTiktokProduct') : t('mapping.selectProviderFirst')}
              >
                {tiktokProducts.data?.map((option) => (
                  <button
                    key={`${option.tiktokSkuId ?? ''}-${option.sellerSku ?? ''}`}
                    type="button"
                    onClick={() => setTiktok(option)}
                    className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {option.productName ?? option.sellerSku}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {option.sellerSku ?? option.tiktokSkuId}
                      </span>
                    </span>
                    {option.mapped && <Badge variant="muted">{t('mapping.alreadyMapped')}</Badge>}
                  </button>
                ))}
              </PickerList>
            </>
          )}
        </div>

        {/* Bước 3 — sản phẩm nhà cung cấp */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              {t('mapping.step3')}
              {(catalogProducts.data?.length ?? 0) > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t('mapping.loadedProducts', { count: catalogProducts.data?.length ?? 0 })}
                </span>
              )}
            </Label>
            {onRefreshCatalog && accountId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRefreshCatalog(accountId)}
                title={t('mapping.catalogCached')}
              >
                <RefreshCw className="size-3.5" />
                {t('mapping.refreshCatalog')}
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder={t('mapping.searchCatalog')}
              className="pl-9"
              disabled={!accountId}
            />
          </div>
          <PickerList
            loading={catalogProducts.isLoading}
            empty={(catalogProducts.data?.length ?? 0) === 0}
            emptyText={accountId ? t('mapping.noCatalogProduct') : t('mapping.selectProviderFirst')}
          >
            {catalogProducts.data?.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => {
                  setProductId(product.id);
                  // Đổi sản phẩm thì biến thể cũ vô nghĩa: xoá cả lựa chọn lẫn từ khoá.
                  setVariantId('');
                  setVariantSearch('');
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-accent',
                  productId === product.id && 'bg-accent/60 font-medium',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{product.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      product.catalogName,
                      product.sku,
                      product.variationsCount !== null
                        ? t('mapping.variantCount', { count: product.variationsCount })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {productId === product.id && <Check className="size-4 shrink-0" />}
              </button>
            ))}
          </PickerList>
        </div>

        {/* Bước 4 — biến thể (tìm được theo tên / SKU / màu / size) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="mapping-variant-search">{t('mapping.step4')}</Label>
            {(variations.data?.length ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('mapping.loadedVariants', { count: variations.data?.length ?? 0 })}
              </span>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="mapping-variant-search"
              value={variantSearch}
              onChange={(e) => setVariantSearch(e.target.value)}
              placeholder={t('mapping.searchVariant')}
              className="pl-9"
              disabled={!productId}
            />
          </div>
          <PickerList
            loading={variations.isLoading}
            empty={filteredVariations.length === 0}
            emptyText={
              !productId
                ? t('mapping.selectProductFirst')
                : (variations.data?.length ?? 0) === 0
                  ? t('mapping.noVariation')
                  : t('mapping.noVariantMatch')
            }
          >
            {filteredVariations.map((variation) => (
              <button
                key={variation.id}
                type="button"
                onClick={() => setVariantId(variation.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-accent',
                  variantId === variation.id && 'bg-accent/60 font-medium',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{variation.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {[variation.sku, variation.color, variation.size]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {variantId === variation.id && <Check className="size-4 shrink-0" />}
              </button>
            ))}
          </PickerList>
          {selectedVariant && (
            <p className="text-xs text-muted-foreground">
              {t('mapping.selected')} — {t('mapping.providerSku')}:{' '}
              <span className="font-mono text-foreground">{selectedVariant.sku}</span>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Khung danh sách chọn: gom ba trạng thái loading / empty / có dữ liệu về một chỗ. */
function PickerList({
  loading,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border p-1">
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : empty ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  );
}
