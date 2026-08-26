'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import {
  useFulfillmentProviderOptions,
  useProviderCatalogProducts,
  useProviderCatalogues,
  useProviderCatalogVariations,
  useTiktokProductOptions,
} from '../hooks/use-fulfillment';
import type { ProductMapping, TiktokProductOption, UpsertProductMappingInput } from '../types';

/** Ứng viên do ánh xạ tự động tìm được — mở dialog ra là đã lọc sẵn. */
export interface MappingCandidateHint {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  variantName: string;
  catalogueId: string | null;
  catalogueName: string | null;
}

interface MappingFormDialogProps {
  open: boolean;
  /** Bỏ trống = tạo mới. */
  mapping?: ProductMapping | null;
  /**
   * Ánh xạ nhanh từ màn hình đơn: khoá sẵn SKU TikTok, bỏ qua bước chọn sản phẩm TikTok.
   * Người dùng không phải rời màn hình đơn để đi tìm đúng dòng hàng.
   */
  presetTiktok?: TiktokProductOption | null;
  /** Nhà cung cấp gán sẵn (từ TikTok Account của đơn) — cũng khoá luôn bước 1. */
  presetAccountId?: string | null;
  /**
   * Ứng viên ánh xạ tự động tìm được nhưng KHÔNG dám tự chọn vì có nhiều hơn một.
   * Hiện lên trên cùng để người dùng chọn một phát, thay vì dò lại từ đầu.
   */
  candidates?: MappingCandidateHint[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (accountId: string, input: UpsertProductMappingInput) => void;
  onSyncCatalog?: (accountId: string) => void;
  syncingCatalog?: boolean;
}

/** Số sản phẩm mỗi trang khi duyệt danh mục nhà cung cấp. */
const PRODUCT_PAGE_SIZE = 20;

/**
 * Id của thẻ `<form>` trong body.
 *
 * Nút Save nằm ở footer GHIM của Modal, tức là ngoài cây DOM của form. `form="<id>"` là cách
 * chuẩn của HTML để nối chúng lại — không cần `useRef` hay gọi `requestSubmit()` thủ công,
 * và validation gốc của trình duyệt vẫn hoạt động.
 */
const FORM_ID = 'mapping-form';

/**
 * Dialog tạo/sửa ánh xạ theo đúng quy trình:
 * nhà cung cấp → sản phẩm TikTok → **danh mục** → sản phẩm nhà cung cấp → biến thể → giá vốn.
 * (Bước "sản phẩm TikTok" được bỏ qua khi mở từ màn hình đơn, vì đã biết sẵn.)
 *
 * 🔴 Không có sản phẩm hay SKU nào được viết cứng: danh sách TikTok lấy từ đơn đã đồng bộ,
 * danh mục nhà cung cấp đọc từ **Database** (do Sync Job ghi xuống).
 *
 * 🔴 Danh mục **KHÔNG** còn được tải hết về trình duyệt rồi lọc tại chỗ. Tìm kiếm và phân
 * trang chạy phía server: một danh mục vài nghìn sản phẩm từng là vài MB JSON mỗi lần mở
 * dialog. Đổi lại, dữ liệu cũ bằng lần đồng bộ gần nhất — nên `lastSyncedAt` luôn hiện kèm
 * và có nút đồng bộ ngay tại chỗ.
 */
export function MappingFormDialog({
  open,
  mapping,
  presetTiktok,
  presetAccountId,
  candidates = [],
  submitting,
  onClose,
  onSubmit,
  onSyncCatalog,
  syncingCatalog = false,
}: MappingFormDialogProps) {
  const { t } = useTranslation(['fulfillment', 'common']);
  const { formatDateTime } = useLocaleFormat();
  const isEdit = Boolean(mapping);

  const [accountId, setAccountId] = useState('');
  const [tiktok, setTiktok] = useState<TiktokProductOption | null>(null);
  const [tiktokSearch, setTiktokSearch] = useState('');
  const [catalogueId, setCatalogueId] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [variantSearch, setVariantSearch] = useState('');
  const [baseCost, setBaseCost] = useState('');

  const debouncedTiktokSearch = useDebouncedValue(tiktokSearch, 350);
  const debouncedCatalogSearch = useDebouncedValue(catalogSearch, 350);

  const providers = useFulfillmentProviderOptions(open);
  const tiktokProducts = useTiktokProductOptions(
    open && !presetTiktok ? accountId || undefined : undefined,
    debouncedTiktokSearch || undefined,
  );
  const catalogues = useProviderCatalogues(open ? accountId || undefined : undefined);
  const catalogProducts = useProviderCatalogProducts(open ? accountId || undefined : undefined, {
    page: productPage,
    limit: PRODUCT_PAGE_SIZE,
    ...(debouncedCatalogSearch ? { search: debouncedCatalogSearch } : {}),
    ...(catalogueId ? { catalogueId } : {}),
  });
  const variations = useProviderCatalogVariations(
    open ? accountId || undefined : undefined,
    productId || undefined,
  );

  // Mỗi lần mở lại phải dựng lại từ dữ liệu truyền vào — tránh mang lựa chọn cũ sang bản ghi khác.
  useEffect(() => {
    if (!open) return;
    setAccountId(presetAccountId ?? '');
    // 🔴 Sửa một ánh xạ ⇒ khoá nghiệp vụ lấy từ CHÍNH bản ghi đó, không bắt chọn lại. Khoá là
    // danh tính của bản ghi: bắt người dùng dò lại đúng sản phẩm trong danh sách chỉ để đổi
    // giá vốn là mời họ chọn nhầm sang sản phẩm khác.
    setTiktok(
      presetTiktok ??
        (mapping
          ? {
              tiktokProductId: mapping.tiktokProductId,
              tiktokSkuId: mapping.tiktokSkuId,
              sellerSku: mapping.sellerSku,
              productName: mapping.providerProductName,
              skuName: mapping.providerVariantName,
              productCategory: null,
              skuImage: null,
              mapped: true,
            }
          : null),
    );
    setCatalogueId('');
    setProductId('');
    setVariantId('');
    setBaseCost(
      mapping?.baseCost === null || mapping?.baseCost === undefined ? '' : String(mapping.baseCost),
    );
    setTiktokSearch('');
    setCatalogSearch('');
    setVariantSearch('');
    setProductPage(1);
  }, [open, mapping, presetTiktok, presetAccountId]);

  // Đổi bộ lọc ⇒ quay lại trang 1, tránh rơi vào trang trống.
  useEffect(() => {
    setProductPage(1);
  }, [debouncedCatalogSearch, catalogueId, accountId]);

  /**
   * Lọc biến thể NGAY TẠI CHỖ: một sản phẩm hiếm khi có quá vài chục biến thể nên danh sách
   * đã tải đủ, gõ tới đâu lọc tới đó (không có độ trễ mạng).
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

  const productItems = catalogProducts.data?.items ?? [];
  const productMeta = catalogProducts.data?.meta;
  const lastSyncedAt = catalogProducts.data?.lastSyncedAt ?? null;

  const selectedVariant = useMemo(
    () => variations.data?.find((variation) => variation.id === variantId) ?? null,
    [variations.data, variantId],
  );
  const selectedProduct = useMemo(
    () => productItems.find((product) => product.id === productId) ?? null,
    [productItems, productId],
  );

  const source = presetTiktok ?? tiktok;

  /**
   * 🔴 Ánh xạ chỉ hợp lệ khi có ĐỦ cặp khoá (Product ID + Seller SKU). Chặn ngay tại nút Lưu
   * thay vì để backend trả 400: sản phẩm TikTok thiếu một trong hai khoá thì bản ghi tạo ra
   * sẽ không ghép được với đơn nào — một dòng dữ liệu chết mà người dùng tưởng đã xong việc.
   */
  const keyComplete = Boolean(source?.tiktokProductId && source?.sellerSku);
  const parsedBaseCost = baseCost.trim() === '' ? null : Number(baseCost);
  const baseCostValid =
    parsedBaseCost === null || (Number.isFinite(parsedBaseCost) && parsedBaseCost >= 0);
  const canSubmit = Boolean(accountId && source && selectedVariant && keyComplete && baseCostValid);

  /** Chọn thẳng một ứng viên do máy gợi ý — nhảy tới đúng sản phẩm và biến thể đó. */
  const pickCandidate = (candidate: MappingCandidateHint) => {
    setCatalogueId(candidate.catalogueId ?? '');
    setProductId(candidate.productId);
    setVariantId(candidate.variantId);
    setVariantSearch('');
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId || !source || !selectedVariant) return;
    if (!source.tiktokProductId || !source.sellerSku || !baseCostValid) return;

    onSubmit(accountId, {
      // 🔴 Gửi tài khoản nhà cung cấp ĐÃ CHỌN. Không gửi thì backend lấy tài khoản mặc định,
      // và tổ chức có hai tài khoản cùng nhà cung cấp sẽ nhận ánh xạ gắn nhầm chỗ.
      accountId,
      // 🔴 KHOÁ NGHIỆP VỤ — cặp này quyết định đơn nào dùng bộ Design của bản ghi.
      tiktokProductId: source.tiktokProductId,
      sellerSku: source.sellerSku,
      // Tham chiếu, không tham gia ghép đơn — giữ để tra ngược về biến thể phía TikTok.
      ...(source.tiktokSkuId ? { tiktokSkuId: source.tiktokSkuId } : {}),
      // Fulfillment SKU — giá trị THỰC SỰ gửi trong items[].sku khi tạo đơn.
      providerSku: selectedVariant.sku,
      ...(parsedBaseCost === null ? {} : { baseCost: parsedBaseCost }),
      // 🔴 Gửi id phía NHÀ CUNG CẤP, không phải khoá nội bộ: đây là thứ dùng để đối chiếu với
      // hệ thống của họ, và khoá nội bộ sẽ đổi nếu bản sao danh mục được dựng lại.
      providerProductId: selectedProduct?.externalProductId ?? '',
      providerVariantId: selectedVariant.externalVariantId,
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
      /* 🔴 Hàng nút GHIM ở đáy, không cuộn theo nội dung.
         Dialog này có 6 bước; để nút Save ở cuối khối cuộn là để nó bị khuất khỏi màn hình ở
         zoom 100% — người dùng phải thu nhỏ trình duyệt mới bấm được.
         Nút submit nằm NGOÀI thẻ <form>, nên nối lại bằng `form={FORM_ID}`. */
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-5">
        {/* Bước 1 — nhà cung cấp */}
        <div className="space-y-2">
          <Label htmlFor="mapping-provider">{t('mapping.step1')}</Label>
          <NativeSelect
            id="mapping-provider"
            value={accountId}
            disabled={Boolean(presetAccountId) || isEdit}
            onChange={(e) => {
              setAccountId(e.target.value);
              // Đổi nhà cung cấp thì danh mục khác hẳn — bỏ mọi lựa chọn cũ.
              setCatalogueId('');
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
              {/* Hiện ĐỦ cặp khoá: đây là thứ quyết định bộ Design áp cho những đơn nào. */}
              <dl className="mt-1 grid gap-x-4 text-xs text-muted-foreground sm:grid-cols-3">
                <div>
                  <dt className="opacity-70">{t('mapping.tiktokProductId')}</dt>
                  <dd className="break-all font-mono">{source.tiktokProductId ?? '—'}</dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('mapping.sellerSku')}</dt>
                  <dd className="break-all font-mono">{source.sellerSku ?? '—'}</dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('mapping.variant')}</dt>
                  <dd>{source.skuName ?? '—'}</dd>
                </div>
              </dl>
              {!keyComplete && (
                <p className="mt-2 text-xs text-destructive">{t('mapping.keyRequiredHint')}</p>
              )}
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
                emptyText={
                  accountId ? t('mapping.noTiktokProduct') : t('mapping.selectProviderFirst')
                }
              >
                {tiktokProducts.data?.map((option) => (
                  <button
                    // Khoá theo ĐÚNG cặp khoá nghiệp vụ — backend cũng gom danh sách theo cặp
                    // này, nên mỗi sản phẩm chỉ xuất hiện một lần.
                    key={`${option.tiktokProductId ?? ''}-${option.sellerSku ?? ''}`}
                    type="button"
                    onClick={() => setTiktok(option)}
                    className="flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {option.productName ?? option.sellerSku}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {option.tiktokProductId} · {option.sellerSku}
                      </span>
                    </span>
                    {option.mapped && <Badge variant="muted">{t('mapping.alreadyMapped')}</Badge>}
                  </button>
                ))}
              </PickerList>
            </>
          )}
        </div>

        {/* Gợi ý của ánh xạ tự động — nhiều ứng viên nên máy KHÔNG dám tự chọn */}
        {candidates.length > 0 && (
          <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" />
              {t('mapping.suggestionsTitle', { count: candidates.length })}
            </div>
            <p className="text-xs text-muted-foreground">{t('mapping.suggestionsHint')}</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {candidates.map((candidate) => (
                <button
                  key={candidate.variantId}
                  type="button"
                  onClick={() => pickCandidate(candidate)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-accent',
                    variantId === candidate.variantId && 'bg-accent/60 font-medium',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {candidate.productName} — {candidate.variantName}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {candidate.sku}
                      {candidate.catalogueName ? ` · ${candidate.catalogueName}` : ''}
                    </span>
                  </span>
                  {variantId === candidate.variantId && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bước 3 — danh mục nhà cung cấp */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="mapping-catalogue">{t('mapping.step3Catalogue')}</Label>
            {/* Nói rõ dữ liệu cũ tới đâu — đây là cái giá của việc đọc từ Database. */}
            <span className="text-xs text-muted-foreground">
              {lastSyncedAt
                ? t('mapping.lastSyncedAt', { time: formatDateTime(lastSyncedAt) })
                : t('mapping.neverSynced')}
            </span>
          </div>
          <NativeSelect
            id="mapping-catalogue"
            value={catalogueId}
            disabled={!accountId}
            onChange={(e) => {
              setCatalogueId(e.target.value);
              // Đổi danh mục thì sản phẩm cũ có thể không còn nằm trong đó.
              setProductId('');
              setVariantId('');
            }}
          >
            <option value="">{t('mapping.allCatalogues')}</option>
            {catalogues.data?.map((catalogue) => (
              <option key={catalogue.id} value={catalogue.id}>
                {catalogue.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        {/* Bước 4 — sản phẩm nhà cung cấp */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              {t('mapping.step3')}
              {productMeta && productMeta.total > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t('mapping.loadedProducts', { count: productMeta.total })}
                </span>
              )}
            </Label>
            {onSyncCatalog && accountId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={syncingCatalog}
                onClick={() => onSyncCatalog(accountId)}
                title={t('mapping.syncCatalogHint')}
              >
                {syncingCatalog ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {t('mapping.syncCatalog')}
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
            empty={productItems.length === 0}
            emptyText={
              !accountId
                ? t('mapping.selectProviderFirst')
                : lastSyncedAt
                  ? t('mapping.noCatalogProduct')
                  : t('mapping.catalogNotSynced')
            }
          >
            {productItems.map((product) => (
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

          {/* Phân trang phía SERVER — không tải cả danh mục về trình duyệt nữa */}
          {productMeta && productMeta.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t('common:pagination.pageWithTotal', {
                  page: productMeta.page,
                  totalPages: productMeta.totalPages,
                  total: productMeta.total,
                })}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={productMeta.page <= 1}
                  onClick={() => setProductPage((page) => page - 1)}
                  aria-label={t('common:action.previous')}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={productMeta.page >= productMeta.totalPages}
                  onClick={() => setProductPage((page) => page + 1)}
                  aria-label={t('common:action.next')}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Bước 5 — biến thể (tìm được theo tên / SKU / màu / size) */}
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
                    {[variation.sku, variation.color, variation.size].filter(Boolean).join(' · ')}
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

        {/* Bước 6 — Base Cost (giá vốn của SẢN PHẨM, không phải của đơn) */}
        <div className="space-y-2">
          <Label htmlFor="mapping-base-cost">{t('mapping.step5')}</Label>
          <Input
            id="mapping-base-cost"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={baseCost}
            onChange={(e) => setBaseCost(e.target.value)}
            placeholder={selectedVariant?.price ?? '0.00'}
            className="max-w-[200px]"
          />
          <p className="text-xs text-muted-foreground">{t('mapping.baseCostHint')}</p>
          {!baseCostValid && (
            <p className="text-xs text-destructive">{t('mapping.baseCostInvalid')}</p>
          )}
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
