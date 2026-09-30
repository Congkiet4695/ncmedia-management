'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, ImageOff, Info, Loader2, RefreshCw, Save } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { useApiError } from '@/hooks/use-api-error';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  POD_DESIGN_PLACEMENTS,
  type PodDesign,
  type PodDesignPlacement,
  type PodOrderItem,
} from '@/features/pod-tiktok/order-types';
import { cn } from '@/lib/utils';
import {
  useFulfillmentOptions,
  useProductMappingActions,
  useProviderCatalogProduct,
  useProviderCatalogProductsInfinite,
  useProviderCatalogVariations,
} from '../hooks/use-fulfillment';
import {
  assignPlacement,
  configBlockers,
  defaultPlacementMap,
  effectiveProductionLine,
  mergeProductOptions,
  productionLineName,
  providerVariantLabel,
  sanitizePlacementMap,
  variantsForProductionLine,
  type ConfigBlocker,
  type PlacementMap,
} from '../product-config';
import { baseCostSaveWarning } from '../base-cost';
import type { ProductMapping, ProviderCatalogProduct, UpsertProductMappingInput } from '../types';
import { DesignSlot } from './design-slot';
import { VariantBaseCost } from './variant-base-cost';

interface ProductConfigPanelProps {
  /** Dòng hàng TikTok đang cấu hình — một khối cho MỖI dòng của đơn. */
  item: PodOrderItem;
  /** Nhà cung cấp gán cho kết nối TikTok của đơn. Thiếu ⇒ không cấu hình được. */
  accountId: string | null;
  /** Ánh xạ hiện có của cặp (Product ID + Seller SKU). `null` = chưa khai. */
  mapping: ProductMapping | null;
  /** Design đã upload của chính cặp khoá đó. */
  designs: PodDesign[];
  /** Lý do chưa gửi được thuộc dòng hàng này (backend phân loại). */
  issues?: string[];
  onSaved: () => void;
  onPreviewDesign: (src: string) => void;
}

/** Cỡ trang khi cuộn danh mục nhà cung cấp — tìm kiếm và phân trang đều chạy phía SERVER. */
const PRODUCT_PAGE_SIZE = 20;

/** Lý do chưa lưu được ⇒ khoá i18n. Một bảng, không rải `if` khắp JSX. */
const BLOCKER_KEY: Record<ConfigBlocker, string> = {
  NO_PROVIDER: 'fulfill.config.noProvider',
  MISSING_PRODUCT_KEY: 'fulfill.config.missingKey',
  NO_PRODUCT: 'fulfill.config.missingProduct',
  PRODUCT_UNAVAILABLE: 'fulfill.config.productUnavailable',
  NO_VARIANT: 'fulfill.config.missingVariant',
};

/**
 * **Cấu hình sản phẩm fulfillment** của MỘT dòng hàng.
 *
 * ```
 *   [ảnh] Tên sản phẩm TikTok · Product ID · Seller SKU · Biến thể · SL   [Xem sản phẩm ↗]
 *   ── Lưu ý của nhà cung cấp (backend trả, không viết cứng ở giao diện) ──
 *   Tên sản phẩm          [ ▾ gõ để tìm toàn bộ danh mục · cuộn để tải thêm ]
 *   Kích thước hình in    [ production config ▾ ]      Line sản xuất [ ▾ ]
 *   [ ] Select by fulfillment SKUs
 *        ├─ tắt : Color [▾]  Size [▾]        → ra đúng một biến thể
 *        └─ bật : chọn thẳng Fulfillment SKU [▾]
 *   Giá vốn (tham chiếu)  [ ... ]
 *   Artwork: mỗi vị trí in một ô (upload / dán URL / xem / thay / xoá)
 *                                                    [ Lưu cấu hình ]
 * ```
 *
 * 🔴 **Nhãn ≠ định danh.** Ô chọn chỉ hiện thứ người vận hành đọc được; UUID/id nằm trong
 * `value` và trong payload. Xem `providerProductLabel` — một luật, một chỗ.
 *
 * 🔴 **Dựng lại cấu hình đã lưu bằng một lời gọi chính xác**, không phải bằng cách tìm gần
 * đúng rồi hy vọng sản phẩm lọt vào trang đang xem: ánh xạ chỉ giữ id nhà cung cấp, nên panel
 * gọi thẳng `catalog/products?externalProductId=…` và ghim bản ghi đó vào đầu danh sách.
 *
 * 🔴 **Nạp lại dữ liệu KHÔNG được xoá thứ người dùng đang gõ.** Effect dựng lại form chỉ chạy
 * khi ÁNH XẠ thật sự đổi (`id` + `updatedAt`), không chạy mỗi lần react-query trả về một
 * object mới — đó chính là lỗi "đang sửa thì mất hết lựa chọn".
 */
export function ProductConfigPanel({
  item,
  accountId,
  mapping,
  designs,
  issues = [],
  onSaved,
  onPreviewDesign,
}: ProductConfigPanelProps) {
  const { t } = useTranslation(['fulfillment', 'pod', 'common']);
  const translateApiError = useApiError();
  const actions = useProductMappingActions();

  const options = useFulfillmentOptions(accountId ?? undefined);

  // ---- Danh mục nhà cung cấp: tìm phía server + cuộn tới đâu tải tới đó ----
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const products = useProviderCatalogProductsInfinite(
    accountId ?? undefined,
    debouncedSearch,
    PRODUCT_PAGE_SIZE,
  );
  const loadedProducts = useMemo(
    () => (products.data?.pages ?? []).flatMap((page) => page.items),
    [products.data?.pages],
  );
  const totalProducts = products.data?.pages[0]?.meta.total ?? 0;

  // ---- Trạng thái form ----
  const [selectedProduct, setSelectedProduct] = useState<ProviderCatalogProduct | null>(null);
  const [productUnavailable, setProductUnavailable] = useState(false);
  const [bySku, setBySku] = useState(false);
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [variantId, setVariantId] = useState('');
  const [productionConfig, setProductionConfig] = useState('');
  const [productionLine, setProductionLine] = useState('');
  /**
   * Vị trí in NCMedia → vùng in của biến thể (chỉ nhà cung cấp có `print_areas` theo biến thể —
   * Sellerwix). `null` = người dùng chưa đụng tới ⇒ dùng ánh xạ đã lưu / mặc định Front-Back.
   */
  const [placementDraft, setPlacementDraft] = useState<PlacementMap | null>(null);

  /**
   * Chữ ký của ÁNH XẠ đang hiển thị.
   *
   * 🔴 Dùng `id + updatedAt` chứ không dùng chính object: react-query trả về một object MỚI ở
   * mỗi lần refetch (mở lại drawer, cửa sổ lấy lại focus, vừa lưu xong…). Effect phụ thuộc
   * object sẽ chạy lại và **xoá trắng lựa chọn người dùng đang thao tác** — đúng triệu chứng
   * "chọn xong quay lại thì mất". Chữ ký chỉ đổi khi bản ghi thật sự đổi.
   */
  const mappingSignature = `${mapping?.id ?? 'none'}:${mapping?.updatedAt ?? ''}`;
  const hydratedRef = useRef<string>('');
  const variantHydratedRef = useRef<string>('');

  useEffect(() => {
    if (hydratedRef.current === mappingSignature) return;
    hydratedRef.current = mappingSignature;
    variantHydratedRef.current = '';

    setSelectedProduct(null);
    setProductUnavailable(false);
    setSearch('');
    setColor(mapping?.providerColor ?? '');
    setSize(mapping?.providerSize ?? '');
    setVariantId('');
    setProductionConfig(mapping?.productionConfig ?? '');
    setProductionLine(mapping?.productionLine ?? '');
    setPlacementDraft(null);
    // Ánh xạ cũ chỉ có SKU mà không có màu/size ⇒ mở thẳng chế độ chọn theo SKU.
    setBySku(Boolean(mapping?.providerSku) && !mapping?.providerColor && !mapping?.providerSize);
  }, [mappingSignature, mapping]);

  /**
   * Bản ghi danh mục của sản phẩm ĐÃ LƯU — một lời gọi, tra chính xác theo id nhà cung cấp.
   * Không tải cả danh mục về chỉ để tìm một dòng, và không phụ thuộc trang đang xem.
   */
  const savedProduct = useProviderCatalogProduct(
    accountId ?? undefined,
    selectedProduct ? null : (mapping?.providerProductId ?? null),
  );

  useEffect(() => {
    if (selectedProduct || !mapping?.providerProductId || !savedProduct.isSuccess) return;
    const found = savedProduct.data?.items[0] ?? null;
    // Không thấy ⇒ sản phẩm đã rời danh mục (nhà cung cấp gỡ, hoặc chưa đồng bộ lại).
    // KHÔNG xoá cấu hình đã lưu, chỉ nói rõ tình trạng.
    setSelectedProduct(found);
    setProductUnavailable(!found);
  }, [savedProduct.isSuccess, savedProduct.data, mapping?.providerProductId, selectedProduct]);

  // ---- Biến thể của sản phẩm đang chọn ----
  const variations = useProviderCatalogVariations(accountId ?? undefined, selectedProduct?.id);
  const allVariants = useMemo(() => variations.data ?? [], [variations.data]);

  /**
   * Line sản xuất đang áp dụng (người dùng chọn, không thì mặc định tài khoản) và TÊN của nó.
   * 🔴 Chỉ SKU của đúng line này được chọn: Mango xếp đơn theo SKU (không có trường production line).
   */
  const lineId = effectiveProductionLine(productionLine, options.data?.defaultProductionLine);
  const lineName = productionLineName(options.data?.productionLines ?? [], lineId);
  const variants = useMemo(
    () => variantsForProductionLine(allVariants, lineName),
    [allVariants, lineName],
  );
  /** SKU ĐÃ LƯU thuộc xưởng khác line đang áp dụng (dữ liệu cũ của lỗi TIKTOK → FASTUS). */
  const savedVariantOtherLine = useMemo(() => {
    if (!lineName || !mapping) return null;
    const saved =
      allVariants.find((variant) => variant.externalVariantId === mapping.providerVariantId) ??
      allVariants.find((variant) => variant.sku === mapping.providerSku) ??
      null;
    const savedLine = saved?.productionLine?.trim().toUpperCase() ?? null;
    return saved && savedLine && savedLine !== lineName ? { sku: saved.sku, line: savedLine } : null;
  }, [allVariants, lineName, mapping]);

  /**
   * Dựng lại biến thể đã lưu — CHỈ một lần cho mỗi ánh xạ, sau khi danh sách biến thể về.
   *
   * Thứ tự phụ thuộc bắt buộc: sản phẩm → biến thể. Đặt biến thể trước khi danh sách về thì
   * chính effect này (hoặc effect đổi sản phẩm) sẽ xoá nó ngay sau đó.
   */
  useEffect(() => {
    if (!mapping || variants.length === 0) return;
    if (variantHydratedRef.current === mappingSignature) return;
    variantHydratedRef.current = mappingSignature;

    const found =
      variants.find((variant) => variant.externalVariantId === mapping.providerVariantId) ??
      variants.find((variant) => variant.sku === mapping.providerSku) ??
      null;
    if (!found) return;
    setVariantId(found.id);
    // Ánh xạ cũ không lưu màu/size ⇒ lấy lại từ chính biến thể, để chế độ Color+Size hiện đúng.
    setColor((prev) => prev || (found.color ?? ''));
    setSize((prev) => prev || (found.size ?? ''));
  }, [variants, mapping, mappingSignature]);

  const colors = useMemo(
    () => [
      ...new Set(
        variants.map((variant) => variant.color).filter((value): value is string => Boolean(value)),
      ),
    ],
    [variants],
  );
  const sizes = useMemo(
    () => [
      ...new Set(
        variants
          .filter((variant) => !color || variant.color === color)
          .map((variant) => variant.size)
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    [variants, color],
  );

  /** Biến thể đang chọn — theo SKU trực tiếp, hoặc suy ra từ cặp Color + Size. */
  const selectedVariant = useMemo(() => {
    if (bySku) return variants.find((variant) => variant.id === variantId) ?? null;
    if (!color && !size) return null;
    return (
      variants.find(
        (variant) => (!color || variant.color === color) && (!size || variant.size === size),
      ) ?? null
    );
  }, [bySku, variants, variantId, color, size]);

  /**
   * Option của ô chọn sản phẩm: lựa chọn hiện tại LUÔN có mặt, kể cả khi nó nằm ở trang 8 hay
   * không khớp từ khoá đang gõ — nếu không, ô chọn rơi về placeholder và người dùng tưởng
   * mình chưa chọn gì.
   */
  const productOptions = useMemo<ComboboxOption[]>(() => {
    const merged: ComboboxOption[] = mergeProductOptions(selectedProduct, loadedProducts);
    if (!selectedProduct && productUnavailable && mapping?.providerProductId) {
      // Sản phẩm đã rời danh mục: vẫn phải thấy TÊN đã lưu (không bao giờ thấy id), nhưng
      // KHÔNG chọn lại được — nó không còn tồn tại để mà tra biến thể.
      merged.unshift({
        value: mapping.providerProductId,
        label: `${mapping.providerProductName ?? t('fulfill.config.unnamedProduct')} ${t('fulfill.config.unavailableSuffix')}`,
        disabled: true,
      });
    }
    return merged;
  }, [selectedProduct, loadedProducts, productUnavailable, mapping, t]);

  const pickProduct = useCallback(
    (value: string) => {
      const found =
        loadedProducts.find((product) => product.id === value) ??
        (selectedProduct?.id === value ? selectedProduct : null);
      // Chỉ những thứ PHỤ THUỘC sản phẩm mới bị đặt lại; production config/line, giá vốn và
      // artwork không liên quan tới việc đổi sản phẩm nên giữ nguyên.
      setSelectedProduct(found);
      setProductUnavailable(false);
      setColor('');
      setSize('');
      setVariantId('');
      setPlacementDraft(null);
      variantHydratedRef.current = mappingSignature;
    },
    [loadedProducts, selectedProduct, mappingSignature],
  );

  /**
   * Option của ô Line sản xuất — nhãn chỉ là TÊN line. Ánh xạ đã lưu một line mà danh sách
   * chưa tải được thì thêm một option trung tính, để không lưu đè bằng rỗng.
   */
  const productionLineOptions = useMemo(() => {
    const lines = options.data?.productionLines ?? [];
    const known = lines.some((line) => line.value === productionLine);
    return [
      { value: '', label: t('fulfill.config.useAccountLine') },
      ...lines.map((line) => ({ value: line.value, label: line.label })),
      ...(productionLine && !known
        ? [{ value: productionLine, label: t('fulfill.config.savedLine') }]
        : []),
    ];
  }, [options.data?.productionLines, productionLine, t]);

  const capabilities = options.data?.capabilities;

  /**
   * Vùng in của biến thể đang chọn. `null` ⇒ nhà cung cấp dùng bộ vị trí in CỐ ĐỊNH (Mango) —
   * dùng `printLocations` của backend như trước.
   */
  const variantPrintAreas = selectedVariant?.printAreas ?? null;
  const placementMap = useMemo<PlacementMap>(() => {
    if (!variantPrintAreas) return {};
    if (placementDraft) return sanitizePlacementMap(placementDraft, variantPrintAreas, POD_DESIGN_PLACEMENTS);
    const saved = sanitizePlacementMap(mapping?.placementMap, variantPrintAreas, POD_DESIGN_PLACEMENTS);
    return Object.keys(saved).length > 0 ? saved : defaultPlacementMap(variantPrintAreas);
  }, [variantPrintAreas, placementDraft, mapping?.placementMap]);

  /**
   * Ô artwork cần hiện: theo ánh xạ vùng in của biến thể (Sellerwix), hoặc danh sách cố định của
   * nhà cung cấp (Mango). Chưa chọn biến thể Sellerwix ⇒ tạm dùng mặc định Front/Back của backend.
   */
  const printLocations = variantPrintAreas
    ? POD_DESIGN_PLACEMENTS.filter((placement) => placementMap[placement]).map((placement) => ({
        placement,
        providerKey: placementMap[placement] as string,
      }))
    : (options.data?.printLocations ?? []);

  /** Nguồn DUY NHẤT của "lưu được chưa" — nút, thông điệp và chốt chặn đều đọc từ đây. */
  const blockers = configBlockers({
    accountId,
    tiktokProductId: item.productId,
    sellerSku: item.sellerSku,
    providerProductId: selectedProduct?.id ?? '',
    productUnavailable,
    variant: selectedVariant,
  });

  const save = () => {
    if (blockers.length > 0) {
      toast.error(t(BLOCKER_KEY[blockers[0]]));
      return;
    }
    // `blockers` rỗng ⇒ ba giá trị dưới đây chắc chắn có; ép kiểu một chỗ thay vì rải `!`.
    const product = selectedProduct as ProviderCatalogProduct;
    const variant = selectedVariant as NonNullable<typeof selectedVariant>;

    const input: UpsertProductMappingInput = {
      accountId: accountId as string,
      tiktokProductId: item.productId as string,
      sellerSku: item.sellerSku as string,
      ...(item.skuId ? { tiktokSkuId: item.skuId } : {}),
      providerSku: variant.sku,
      // 🔴 LUÔN là id phía nhà cung cấp, lấy từ chính bản ghi đang chọn — không bao giờ là id
      // nội bộ, kể cả khi danh sách đang hiển thị kết quả tìm kiếm khác.
      providerProductId: product.externalProductId,
      providerVariantId: variant.externalVariantId,
      providerProductName: product.name,
      providerVariantName: variant.name,
      ...(variant.color ? { providerColor: variant.color } : {}),
      ...(variant.size ? { providerSize: variant.size } : {}),
      ...(productionConfig ? { productionConfig } : {}),
      ...(productionLine ? { productionLine } : {}),
      // 🔴 KHÔNG gửi Base Cost: backend tự lấy giá của đúng biến thể này từ nhà cung cấp.
      // Vị trí in theo biến thể (Sellerwix) — gửi đúng khoá `print_areas[].key` đã chọn.
      ...(variantPrintAreas ? { placementMap: placementMap as Record<string, string> } : {}),
    };

    const run = mapping
      ? actions.update.mutateAsync({ id: mapping.id, input })
      : actions.create.mutateAsync(input);
    void run
      .then((saved) => {
        toast.success(t('fulfill.config.saved'), { description: variant.sku });
        // Lưu được ánh xạ nhưng KHÔNG cập nhật được Base Cost ⇒ nói thẳng, không để người dùng
        // tưởng giá đã được lấy.
        const warning = baseCostSaveWarning(saved);
        if (warning) toast.warning(t(warning.key), { description: warning.message ?? undefined });
        onSaved();
      })
      .catch((error: unknown) =>
        toast.error(t('fulfill.config.saveFailed'), { description: translateApiError(error) }),
      );
  };

  const saving = actions.create.isPending || actions.update.isPending;

  return (
    <div className="space-y-3 rounded-md border p-3">
      {/* -------------------------------------------------- Sản phẩm TikTok đang cấu hình */}
      <div className="flex gap-3">
        {item.productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.productImage}
            alt=""
            className="size-14 shrink-0 rounded border object-cover"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded border bg-muted">
            <ImageOff className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5 text-xs">
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {item.productName ?? item.sellerSku ?? t('fulfill.config.unnamedProduct')}
          </p>
          <p className="text-muted-foreground">
            <span className="font-mono">{item.productId ?? '—'}</span>
            {' · '}
            <span className="font-mono">{item.sellerSku ?? '—'}</span>
            {item.skuName && <span> · {item.skuName}</span>}
            <span> · × {item.quantity}</span>
          </p>
          <Link
            href={`/dashboard/pod/products?search=${encodeURIComponent(item.productId ?? '')}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3" />
            {t('fulfill.config.viewProduct')}
          </Link>
        </div>
        <Badge variant={mapping ? 'success' : 'destructive'} className="h-5 shrink-0">
          {t(`fulfill.mappingStatus.${mapping ? 'MAPPED' : item.mappingStatus}`)}
        </Badge>
      </div>

      {issues.length > 0 && (
        <ul className="space-y-1 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------- Lưu ý của nhà cung cấp (backend trả về) */}
      {options.data?.notice && (
        <p className="flex gap-1.5 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <Info className="mt-px size-3.5 shrink-0" />
          {options.data.notice}
        </p>
      )}
      {(options.data?.warnings ?? []).map((warning, index) => (
        <p key={index} className="text-[11px] text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}

      {!accountId ? (
        <p className="text-xs text-destructive">{t('fulfill.config.noProvider')}</p>
      ) : (
        <>
          {/* ------------------------------------------------------- Sản phẩm nhà cung cấp */}
          <div className="space-y-1">
            <Label>{t('fulfill.config.providerProduct')}</Label>
            <Combobox
              value={selectedProduct?.id ?? (productUnavailable ? (mapping?.providerProductId ?? '') : '')}
              onChange={pickProduct}
              options={productOptions}
              placeholder={t('fulfill.config.selectProduct')}
              searchPlaceholder={t('fulfill.config.searchProduct')}
              emptyMessage={t('fulfill.config.noProductFound')}
              // Tìm kiếm chạy phía SERVER trên toàn bộ danh mục — component không tự lọc
              // những gì đã tải (đó chính là lỗi "gõ Canvas mà không thấy sản phẩm ở trang 15").
              onSearchChange={setSearch}
              loading={products.isLoading || savedProduct.isLoading}
              onLoadMore={() => void products.fetchNextPage()}
              hasMore={products.hasNextPage}
              loadingMore={products.isFetchingNextPage}
              endMessage={t('fulfill.config.endOfProducts')}
            />
            <p className="text-[11px] text-muted-foreground">
              {products.isLoading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {t('fulfill.config.loadingProducts')}
                </span>
              ) : (
                t('fulfill.config.productCount', {
                  shown: loadedProducts.length,
                  total: totalProducts,
                })
              )}
            </p>
            {productUnavailable && (
              <p className="flex gap-1.5 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                {t('fulfill.config.productUnavailable')}
              </p>
            )}
          </div>

          {/* --------------------------------------- Production config + line sản xuất */}
          {/* Chỉ nhà cung cấp CÓ hai khái niệm này (Mango) — Sellerwix không có trong API. */}
          {(capabilities?.productionConfig || capabilities?.productionLine) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {capabilities.productionConfig && (
            <div className="space-y-1">
              <Label>{t('fulfill.config.productionConfig')}</Label>
              <Combobox
                value={productionConfig}
                onChange={setProductionConfig}
                options={[
                  { value: '', label: t('fulfill.config.providerDefault') },
                  ...(options.data?.productionConfigs ?? []).map((entry) => ({
                    value: entry.value,
                    label: entry.label,
                  })),
                ]}
              />
            </div>
            )}
            {capabilities.productionLine && (
            <div className="space-y-1">
              <Label>{t('fulfill.config.productionLine')}</Label>
              <Combobox
                value={productionLine}
                onChange={setProductionLine}
                options={productionLineOptions}
              />
              <p className="text-[11px] text-muted-foreground">
                {options.isLoading
                  ? t('fulfill.config.loadingOptions')
                  : (options.data?.productionLines ?? []).length === 0
                    ? t('fulfill.config.productionLineUnavailable')
                    : t('fulfill.config.productionLineHint')}
              </p>
            </div>
            )}
          </div>
          )}

          {/* ------------------------------------------------- Biến thể: SKU hoặc Color/Size */}
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={bySku}
              onChange={(event) => {
                setBySku(event.target.checked);
                setColor('');
                setSize('');
                setVariantId('');
              }}
            />
            {t('fulfill.config.selectBySku')}
          </label>

          {variations.isFetching ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t('fulfill.config.loadingVariants')}
            </p>
          ) : bySku ? (
            <div className="space-y-1">
              <Label>{t('fulfill.config.fulfillmentSku')}</Label>
              <Combobox
                value={variantId}
                onChange={setVariantId}
                options={[
                  { value: '', label: t('fulfill.config.selectSku') },
                  // SKU + tên biến thể (Black / XL) là thứ người vận hành đối chiếu; id biến
                  // thể nằm ở `value`.
                  ...variants.map((variant) => ({
                    value: variant.id,
                    label: providerVariantLabel(variant),
                  })),
                ]}
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('fulfill.config.color')}</Label>
                <Combobox
                  value={color}
                  onChange={(value) => {
                    setColor(value);
                    setSize('');
                  }}
                  options={[
                    { value: '', label: t('fulfill.config.selectColor') },
                    ...colors.map((value) => ({ value, label: value })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('fulfill.config.size')}</Label>
                <Combobox
                  value={size}
                  onChange={setSize}
                  options={[
                    { value: '', label: t('fulfill.config.selectSize') },
                    ...sizes.map((value) => ({ value, label: value })),
                  ]}
                />
              </div>
            </div>
          )}

          {savedVariantOtherLine && (
            <p className="flex gap-1.5 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {t('fulfill.config.savedSkuOtherLine', {
                sku: savedVariantOtherLine.sku,
                savedLine: savedVariantOtherLine.line,
                line: lineName,
              })}
            </p>
          )}
          {lineName && allVariants.length > 0 && variants.length === 0 && (
            <p className="text-xs text-destructive">
              {t('fulfill.config.noVariantOnLine', { line: lineName })}
            </p>
          )}

          {/* Chốt được biến thể ⇒ hiện SKU sẽ gửi đi; chưa chốt ⇒ nói rõ còn thiếu gì. */}
          <p
            className={cn(
              'rounded-md p-2 text-xs',
              blockers.length > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted',
            )}
          >
            {blockers.length > 0
              ? blockers.map((code) => t(BLOCKER_KEY[code])).join(' · ')
              : t('fulfill.config.resolvedSku', {
                  sku: selectedVariant?.sku,
                  variant: selectedVariant?.productionLine
                    ? `${selectedVariant.name} · ${selectedVariant.productionLine}`
                    : selectedVariant?.name,
                })}
          </p>

          {/* Base Cost = giá nhà cung cấp của ĐÚNG biến thể đang chọn (backend lấy + lưu). */}
          <VariantBaseCost
            accountId={accountId}
            variantId={selectedVariant?.id}
            savedBaseCost={mapping?.baseCost}
          />

          {/* ------------------------------------ Vùng in theo biến thể (Sellerwix print_areas) */}
          {variantPrintAreas && (
            <div className="space-y-1">
              <Label>{t('fulfill.config.printAreas')}</Label>
              {variantPrintAreas.length === 0 ? (
                <p className="text-xs text-destructive">{t('fulfill.config.printAreasEmpty')}</p>
              ) : (
                <div className="space-y-1.5">
                  {variantPrintAreas.map((area) => {
                    const assigned =
                      (Object.entries(placementMap) as Array<[PodDesignPlacement, string]>).find(
                        ([, key]) => key === area.key,
                      )?.[0] ?? '';
                    return (
                      <div key={area.key} className="grid grid-cols-2 items-center gap-2 text-xs">
                        <span className="min-w-0 truncate">
                          {area.displayName ?? area.key}
                          <span className="ml-1 font-mono text-muted-foreground">({area.key})</span>
                          {area.required && (
                            <Badge variant="warning" className="ml-1 h-4 px-1 text-[10px]">
                              {t('fulfill.config.printAreaRequired')}
                            </Badge>
                          )}
                        </span>
                        <Combobox
                          value={assigned}
                          onChange={(value) =>
                            setPlacementDraft(
                              assignPlacement(placementMap, area.key, value as PodDesignPlacement | ''),
                            )
                          }
                          options={[
                            { value: '', label: t('fulfill.config.printAreaUnused') },
                            ...POD_DESIGN_PLACEMENTS.map((placement) => ({
                              value: placement,
                              label: placement,
                            })),
                          ]}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{t('fulfill.config.printAreasHint')}</p>
            </div>
          )}

          {/* ------------------------------------------------------------ Artwork / Design */}
          <div className="space-y-2">
            <Label>{t('fulfill.config.artwork')}</Label>
            {item.productId && item.sellerSku ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {printLocations.map((location) => (
                  <DesignSlot
                    key={location.placement}
                    productKey={{
                      tiktokProductId: item.productId as string,
                      sellerSku: item.sellerSku as string,
                    }}
                    placement={location.placement}
                    design={
                      designs.find((design) => design.placement === location.placement) ?? null
                    }
                    onPreview={onPreviewDesign}
                  />
                ))}
                {printLocations.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {options.isLoading
                      ? t('fulfill.config.loadingOptions')
                      : t('fulfill.config.noPrintLocations')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-destructive">{t('fulfill.config.missingKey')}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {t('fulfill.config.artworkHint', {
                keys: printLocations.map((location) => location.providerKey).join(', ') || '—',
              })}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={products.isFetching || variations.isFetching}
              onClick={() => {
                void products.refetch();
                void variations.refetch();
                void options.refetch();
              }}
            >
              <RefreshCw className="size-3.5" />
              {t('common:action.refresh')}
            </Button>
            <Button size="sm" onClick={save} disabled={saving || blockers.length > 0}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t('fulfill.config.save')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
