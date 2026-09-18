'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, RefreshCw, Rocket, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { AttributeValuePicker } from '@/features/pod-listing/components/attribute-value-picker';
import {
  useCategoryAttributes,
  usePodTemplates,
  useSyncedBrands,
  useSyncedCategories,
  useWarehouses,
} from '@/features/pod-listing/hooks/use-pod-listing';
import { podListingService } from '@/features/pod-listing/services/pod-listing.service';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';
import { BulkSkuBar, type BulkSkuPatch } from '@/features/pod-product/components/bulk-sku-bar';
import { buildSkuCombinations, countCombinations } from '../manual-sku';
import {
  useCreateCustomListing,
  useListingSession,
  useSessionProducts,
  useStartSessionListing,
  useUpdateCustomListing,
  useValidateSession,
} from '../hooks';
import {
  POD_LISTING_MARKETS,
  currencyForMarket,
  type PodListingMarket,
} from '@/features/pod-listing/types';
import type {
  PodCategoryTemplate,
  PodDescriptionTemplate,
  PodImageTemplate,
  PodSkuTemplate,
} from '@/features/pod-listing/types';
import type { ManualAttribute, ManualSku } from '../types';
import {
  applyCategoryTemplate,
  applyImageTemplate,
  applySkuTemplate,
} from '../template-apply';
import {
  buildCustomListingPayload,
  buildUpdateCustomListingPayload,
  checkCustomListingForm,
  emptyCustomListingForm,
  pruneAttributeValues,
  restoreCustomListingForm,
  SEARCH_TERMS_MAX,
  TITLE_MAX,
  type CustomListingCheck,
  type CustomListingForm as FormState,
} from '../custom-listing-state';
import { MEDIA_LIMITS, MediaEditor } from './media-editor';
import { TemplatePicker } from './template-picker';
import { ShopMultiSelect } from './shop-multi-select';
import { SkuEditor } from './sku-editor';
import { VariationEditor } from './variation-editor';

/** Trần TikTok (Create Product). Chặn ngay tại chỗ gõ, không đợi tới lúc gọi API. */
const DESCRIPTION_MAX = 10_000;
/** Trên ngưỡng này thì hỏi lại trước khi dựng lưới — 3 trục là ra hàng trăm dòng rất nhanh. */
const SKU_WARN_THRESHOLD = 200;
/** Gõ tìm danh mục/brand ⇒ hỏi server sau một nhịp, không hỏi theo từng phím. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * 🔴 Dùng ĐÚNG enum `PodListingMarket` của hệ thống (18 thị trường thật), KHÔNG phải cặp
 * "US / NON-US" của ảnh tham chiếu. Gộp 17 thị trường thành một nhãn "NON-US" nghe gọn nhưng
 * cây danh mục, thương hiệu và kho của TikTok khác nhau theo TỪNG thị trường — gộp lại là
 * đăng hàng bằng dữ liệu của một nước khác.
 */
const MARKETS = POD_LISTING_MARKETS;

/** Thông điệp cho từng mã kiểm nhanh phía client — cùng câu chữ với backend. */
const CHECK_MESSAGE: Record<CustomListingCheck, string> = {
  TITLE_REQUIRED: 'listing.manual.titleRequired',
  TITLE_TOO_LONG: 'listing.manual.titleTooLong',
  SHOP_REQUIRED: 'listing.custom.needShop',
  CATEGORY_REQUIRED: 'listing.custom.categoryRequired',
  SKU_REQUIRED: 'listing.custom.skuRequired',
  SKU_INVALID: 'listing.custom.skuInvalid',
  CURRENCY_REQUIRED: 'listing.custom.currencyRequired',
  DESCRIPTION_IMAGE_INVALID: 'listing.custom.descriptionImageInvalid',
};

/**
 * **Add / Edit Custom Listing** — nhập tay MỘT sản phẩm rồi đăng lên NHIỀU shop.
 *
 * ```
 *   Form  →  POST /pod/listing-sessions/custom          (tạo: lượt đăng + 1 Draft Product)
 *         →  PATCH /pod/listing-sessions/:id/custom     (sửa: CÙNG lượt, CÙNG Draft Product)
 *              ├─ "Lưu nháp"      dừng ở đây
 *              ├─ "Kiểm tra"      POST /:id/validate
 *              └─ "Đăng sản phẩm" POST /:id/start → fan-out 1 sản phẩm × N shop
 *                                    ↓ Bulk Listing Engine (5 luồng · retry 3 · backoff)
 *                                  kết quả + lỗi theo TỪNG shop, retry riêng từng shop
 * ```
 *
 * 🔴 KHÔNG dựng đường listing thứ hai. Custom Listing ghi vào ĐÚNG `pod_listing_sessions`
 * mà luồng CSV/Excel dùng — chỉ khác nguồn dữ liệu (form thay vì file). Nhờ vậy nó thừa
 * hưởng nguyên vẹn hàng đợi, retry, kết quả theo shop và phân quyền theo shop, và luồng
 * import cũ không bị đụng tới một dòng nào.
 *
 * 🔴 Mỗi khu vực có thể lấy từ MẪU, NHẬP TAY, hoặc KẾT HỢP — mẫu chỉ là nguồn dữ liệu, không
 * phải điều kiện. Mẫu đang chọn được lưu vào lượt đăng (nguồn cho phần chưa nhập tay), phần
 * đã nhập tay thắng mẫu. Toàn bộ trạng thái form ⇄ payload nằm ở `custom-listing-state.ts`.
 *
 * 🔴 Danh mục và brand khoá theo MÃ TIKTOK và giữ luôn nhãn: danh sách tìm kiếm chỉ là 500 dòng
 * đầu của một cây ~10.000 nút, nên "tra ngược danh sách để tìm cái đã chọn" là mất lựa chọn
 * ngay khi ô tìm kiếm được dọn (đúng lỗi "chọn Poster rồi vẫn bảo chưa chọn danh mục").
 */
export function CustomListingForm({ sessionId }: { sessionId?: string }) {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canRun = hasPermission('pod.listing.run');
  const editing = Boolean(sessionId);

  const createCustom = useCreateCustomListing();
  const updateCustom = useUpdateCustomListing();
  const validate = useValidateSession();
  const start = useStartSessionListing();

  const [form, setForm] = useState<FormState>(emptyCustomListingForm);
  const patch = useCallback(
    (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next })),
    [],
  );
  const [issues, setIssues] = useState<Array<{ field: string; message: string }> | null>(null);
  /**
   * Lượt đăng mà form này ĐANG ghi vào. Mở từ màn sửa thì có sẵn; tạo mới thì nhận id ngay
   * sau lần lưu đầu tiên — từ đó mọi lần Lưu/Kiểm tra/Đăng đều là SỬA lượt đó, không tạo thêm.
   */
  const [persistedId, setPersistedId] = useState<string | null>(sessionId ?? null);
  /** Ảnh trong mô tả đang tải lên Storage — khoá Lưu/Kiểm tra/Đăng cho tới khi xong. */
  const [descriptionUploading, setDescriptionUploading] = useState(false);

  // --- Chế độ sửa: nạp lượt đăng + Draft Product duy nhất rồi dựng lại form ĐÚNG MỘT LẦN ---
  // Nạp lại ở mỗi lần refetch (polling, sau khi lưu) là xoá mất thứ người dùng đang gõ.
  const session = useListingSession(sessionId);
  const products = useSessionProducts(sessionId, { limit: 1 });
  const restoredFrom = useRef<string | null>(null);
  /**
   * Bộ thuộc tính đã lưu trong nháp — dự phòng cho lúc bấm Lưu khi định nghĩa thuộc tính của
   * danh mục chưa nạp xong (gửi `[]` lúc đó là xoá sạch thuộc tính đã chọn).
   */
  const savedAttributes = useRef<ManualAttribute[]>([]);
  useEffect(() => {
    if (!sessionId || !session.data || !products.data) return;
    if (restoredFrom.current === sessionId) return;
    restoredFrom.current = sessionId;
    const product = products.data.items[0] ?? null;
    savedAttributes.current = product?.manualData?.attributes ?? [];
    setForm(restoreCustomListingForm(session.data, product));
  }, [sessionId, session.data, products.data]);

  const sessionLocked = session.data?.status === 'LISTING';
  /**
   * Tiền tệ của listing — suy từ thị trường, CHỈ ĐỌC. Backend tra lại theo region của shop đích
   * lúc đăng (`resolveListingCurrency`); ở đây hiện ra để người dùng biết giá đang nhập bằng
   * tiền gì, và đổi Market là con số này đổi theo ngay.
   */
  const currency = currencyForMarket(form.market);
  const notCustom = Boolean(session.data && session.data.source && session.data.source !== 'CUSTOM');

  /**
   * Danh sách shop chọn được.
   *
   * 🔴 Dùng LẠI `GET /pod/products/filters` — endpoint này đã trả về đúng tập shop mà người
   * dùng được phép thấy (`PodAccessScopeService` lọc sẵn), kèm Connection Name. Tạo thêm một
   * endpoint "shop của tôi" là nhân bản đúng phép lọc phân quyền đó ra chỗ thứ hai.
   * Backend kiểm lại lần nữa khi tạo/sửa lượt (`assertShopsBelongToOrg`).
   */
  const shopFilters = usePodProductFilters();

  // --- Danh mục: tìm phía SERVER, debounce; danh mục đang chọn luôn nằm trong danh sách ---
  const [categorySearch, setCategorySearch] = useState('');
  const debouncedCategorySearch = useDebouncedValue(categorySearch, SEARCH_DEBOUNCE_MS);
  const categories = useSyncedCategories({
    search: debouncedCategorySearch || undefined,
    leafOnly: true,
  });
  const categoryOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const options: ComboboxOption[] = [];
    if (form.category.id) {
      seen.add(form.category.id);
      options.push({
        value: form.category.id,
        label: form.category.path || form.category.name || form.category.id,
        hint: form.category.id,
      });
    }
    for (const item of categories.data ?? []) {
      if (seen.has(item.tiktokCategoryId)) continue;
      seen.add(item.tiktokCategoryId);
      options.push({
        value: item.tiktokCategoryId,
        label: item.path ?? item.localName ?? item.tiktokCategoryId,
        hint: item.tiktokCategoryId,
      });
    }
    return options;
  }, [categories.data, form.category]);

  // 🔴 Thuộc tính nạp theo danh mục ĐANG chọn (nhận mã TikTok). Backend tự hỏi TikTok nếu
  // kho chưa có (xem `PodProductService.findCategoryAttributes`).
  const attributes = useCategoryAttributes(form.category.id || undefined);
  /**
   * Định nghĩa thuộc tính của danh mục mới nạp xong ⇒ GIỮ giá trị còn hợp lệ, BỎ phần còn
   * lại. Đổi danh mục A → B thì thuộc tính của A không lọt sang B; mở lại nháp hay áp Category
   * Template thì giá trị đã lưu vẫn còn nếu danh mục vẫn có thuộc tính đó.
   */
  useEffect(() => {
    if (!attributes.data) return;
    const definitions = attributes.data;
    setForm((prev) => ({
      ...prev,
      attributeValues: pruneAttributeValues(prev.attributeValues, definitions),
    }));
  }, [attributes.data]);

  // --- Brand: tìm phía server, brand đang chọn luôn có mặt ---
  const [brandSearch, setBrandSearch] = useState('');
  const debouncedBrandSearch = useDebouncedValue(brandSearch, SEARCH_DEBOUNCE_MS);
  const brands = useSyncedBrands({ keyword: debouncedBrandSearch || undefined, limit: 50 });
  const brandOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const options: ComboboxOption[] = [
      { value: '', label: t('listing.categoryTemplates.noBrand') },
    ];
    if (form.brand.id) {
      seen.add(form.brand.id);
      options.push({ value: form.brand.id, label: form.brand.name || form.brand.id });
    }
    for (const brand of brands.data?.items ?? []) {
      if (seen.has(brand.tiktokBrandId)) continue;
      seen.add(brand.tiktokBrandId);
      options.push({ value: brand.tiktokBrandId, label: brand.name ?? brand.tiktokBrandId });
    }
    return options;
  }, [brands.data, form.brand, t]);

  const warehouses = useWarehouses(
    form.shopIds.length === 1 ? { shopId: form.shopIds[0] } : {},
  );

  // Template của tổ chức — nạp một lần, lọc tại chỗ trong `TemplatePicker`.
  const categoryTemplates = usePodTemplates<PodCategoryTemplate>('categories', { limit: 100 });
  const descriptionTemplates = usePodTemplates<PodDescriptionTemplate>('descriptions', { limit: 100 });
  const skuTemplates = usePodTemplates<PodSkuTemplate>('skus', { limit: 100 });
  const imageTemplates = usePodTemplates<PodImageTemplate>('images', { limit: 100 });

  const setTemplate = (key: keyof FormState['templates'], id: string) =>
    setForm((prev) => ({ ...prev, templates: { ...prev.templates, [key]: id } }));

  /**
   * Áp Category Template — điền market, danh mục (kèm giá trị thuộc tính), brand, kho, đóng
   * gói, bảng size, video.
   *
   * 🔴 Chỉ ghi những trường template THỰC SỰ khai (`applyCategoryTemplate` trả `undefined`
   * cho phần còn lại), nên áp một mẫu chỉ khai danh mục sẽ KHÔNG xoá kho người dùng đã chọn.
   * Danh mục ghi thẳng bằng mã TikTok + nhãn của template — không cần tra ngược danh sách.
   */
  const handleApplyCategoryTemplate = (id: string) => {
    const template = categoryTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    const applied = applyCategoryTemplate(template);

    setForm((prev) => ({
      ...prev,
      ...(applied.market ? { market: applied.market } : {}),
      ...(applied.categoryTiktokId
        ? {
            category: {
              id: applied.categoryTiktokId,
              name: applied.categoryName ?? '',
              path: applied.categoryPath ?? '',
            },
            attributeValues: applied.attributeValues ?? {},
          }
        : {}),
      ...(applied.brandId !== undefined
        ? { brand: { id: applied.brandId, name: template.brandName ?? '' } }
        : {}),
      ...(applied.warehouseId ? { warehouseId: applied.warehouseId } : {}),
      ...(applied.package ? { pkg: { ...prev.pkg, ...applied.package } } : {}),
      ...(applied.sizeChartFileId
        ? { sizeChart: { imageUrl: '', fileId: applied.sizeChartFileId, imageType: 'SIZE_CHART' as const } }
        : {}),
      ...(applied.videoFileId ? { video: { fileId: applied.videoFileId } } : {}),
    }));
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const handleApplyDescriptionTemplate = (id: string) => {
    const template = descriptionTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    // Nạp HTML vào editor — giữ nguyên định dạng, người dùng sửa tiếp được.
    patch({ description: template.contentHtml });
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const handleApplySkuTemplate = (id: string) => {
    const template = skuTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    const applied = applySkuTemplate(template);
    // Mẫu đã sinh tổ hợp thì lấy nguyên bảng giá của nó; chưa sinh thì để người dùng bấm
    // "Tạo SKU" — không tự sinh thay họ, vì số tổ hợp có thể rất lớn.
    patch({ variations: applied.variations, skus: applied.skus });
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const handleApplyImageTemplate = (id: string) => {
    const template = imageTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    const applied = applyImageTemplate(template);
    patch({ images: applied.images });
    if (applied.skipped > 0) {
      toast.warning(t('listing.templatePicker.imagesSkipped', { count: applied.skipped }));
    }
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const pendingSkuCount = useMemo(() => countCombinations(form.variations), [form.variations]);
  const busy =
    createCustom.isPending ||
    updateCustom.isPending ||
    validate.isPending ||
    start.isPending ||
    descriptionUploading;

  const generateSkus = () => {
    if (pendingSkuCount === 0) {
      toast.error(t('listing.manual.needVariation'));
      return;
    }
    if (
      pendingSkuCount > SKU_WARN_THRESHOLD &&
      !window.confirm(t('listing.manual.confirmManySkus', { count: pendingSkuCount }))
    ) {
      return;
    }
    // `skus` hiện tại được truyền vào để giữ giá/Seller SKU người dùng đã gõ — xem
    // `buildSkuCombinations`. Bấm "Tạo SKU" lần hai KHÔNG được xoá công đã làm.
    setForm((prev) => ({ ...prev, skus: buildSkuCombinations(prev.variations, prev.skus) }));
  };

  /** Cập nhật hàng loạt — cùng thanh công cụ với màn hình Sửa sản phẩm. */
  const applyBulk = (bulk: BulkSkuPatch, matchedKeys: string[]) => {
    const matched = new Set(matchedKeys);
    setForm((prev) => ({
      ...prev,
      skus: prev.skus.map((sku, index) =>
        matched.has(skuKey(sku, index))
          ? {
              ...sku,
              ...(bulk.salePrice !== undefined ? { salePrice: bulk.salePrice } : {}),
              ...(bulk.listPrice !== undefined ? { retailPrice: bulk.listPrice } : {}),
              ...(bulk.quantity !== undefined ? { quantity: Number(bulk.quantity) } : {}),
            }
          : sku,
      ),
    }));
  };

  /** Cảnh báo rời trang khi còn dữ liệu chưa lưu (§17). */
  useEffect(() => {
    const dirty = Boolean(
      form.title.trim() ||
        form.description.trim() ||
        form.skus.length > 0 ||
        form.images.length > 0 ||
        form.video,
    );
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [form.title, form.description, form.skus.length, form.images.length, form.video]);

  /** Kiểm nhanh phía client; trả `false` khi có lỗi (đã báo). */
  const precheck = (mode: 'DRAFT' | 'SUBMIT'): boolean => {
    const checks = checkCustomListingForm(form, mode, currency);
    for (const check of checks) {
      toast.error(t(CHECK_MESSAGE[check], { max: TITLE_MAX }));
    }
    return checks.length === 0;
  };

  /**
   * Ghi form xuống. Tạo mới ⇒ `POST /custom`; đang sửa ⇒ `PATCH /:id/custom` trên ĐÚNG lượt
   * đang mở — không bao giờ đẻ thêm bản nháp. Trả về session id để bước sau dùng.
   */
  const persist = async (mode: 'DRAFT' | 'SUBMIT'): Promise<string | null> => {
    if (!precheck(mode)) return null;
    // Cảnh báo, KHÔNG chặn: bộ ảnh có thể đến từ Image Template của lượt đăng, và cổng
    // Validate của backend mới là nơi phán quyết cuối cùng.
    if (form.images.length > 0 && form.images.length < MEDIA_LIMITS.IMAGE_MIN_RECOMMENDED) {
      toast.warning(
        t('listing.media.fewImages', {
          count: form.images.length,
          min: MEDIA_LIMITS.IMAGE_MIN_RECOMMENDED,
        }),
      );
    }

    const attributeSource = {
      definitions: attributes.isSuccess ? attributes.data : undefined,
      fallback: savedAttributes.current,
    };

    try {
      if (persistedId) {
        const result = await updateCustom.mutateAsync({
          id: persistedId,
          payload: buildUpdateCustomListingPayload(form, attributeSource),
        });
        return result.id;
      }
      const created = await createCustom.mutateAsync(
        buildCustomListingPayload(form, attributeSource),
      );
      setPersistedId(created.id);
      return created.id;
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
      return null;
    }
  };

  const handleSaveDraft = async () => {
    const id = await persist('DRAFT');
    if (!id) return;
    toast.success(editing ? t('listing.custom.draftUpdated') : t('listing.custom.draftSaved'));
    router.push(`/dashboard/pod/auto-listing/${id}`);
  };

  const handleValidate = async () => {
    const id = await persist('DRAFT');
    if (!id) return;
    try {
      const result = await validate.mutateAsync(id);
      // 🔴 Gộp lỗi theo NỘI DUNG: cùng một lỗi ở nhiều SKU/nhiều shop chỉ hiện một dòng (§13).
      const unique = new Map<string, { field: string; message: string }>();
      for (const issue of [...result.issues, ...result.products.flatMap((p) => p.issues)]) {
        unique.set(`${issue.field}|${issue.message}`, { field: issue.field, message: issue.message });
      }
      setIssues([...unique.values()]);
      if (unique.size === 0) toast.success(t('listing.custom.validateOk'));
    } catch (error) {
      toast.error(translateApiError(error));
    }
  };

  const handleSubmit = async () => {
    if (!precheck('SUBMIT')) return;
    if (!window.confirm(t('listing.custom.confirmSubmit', { count: form.shopIds.length }))) return;
    const id = await persist('SUBMIT');
    if (!id) return;
    try {
      const result = await start.mutateAsync({ id });
      toast.success(
        t('listing.sessions.started', { products: result.started, targets: result.targets }),
      );
      // Sang màn hình chi tiết — nơi đã có tiến độ và kết quả theo từng shop.
      router.push(`/dashboard/pod/auto-listing/${id}`);
    } catch (error) {
      toast.error(translateApiError(error));
    }
  };

  if (editing && (session.isLoading || products.isLoading)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (editing && (session.isError || !session.data)) {
    return <p className="text-sm text-destructive">{t('listing.custom.loadFailed')}</p>;
  }
  if (notCustom) {
    return <p className="text-sm text-destructive">{t('listing.custom.notCustom')}</p>;
  }

  return (
    <div className="space-y-4 pb-24">
      {sessionLocked && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {t('listing.custom.locked')}
        </div>
      )}

      {/* ---------- 1. Thị trường & Cửa hàng ---------- */}
      <Section title={t('listing.custom.marketShop')}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1">
            <Label>
              {t('listing.sessions.market')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Combobox
              value={form.market}
              onChange={(value) => patch({ market: value as PodListingMarket })}
              options={MARKETS.map((value) => ({ value, label: value }))}
            />
            <p className="text-xs text-muted-foreground">{t('listing.custom.marketHint')}</p>
          </div>

          <div className="space-y-1">
            <Label>{t('listing.custom.currency')}</Label>
            <Input value={currency ?? '—'} readOnly disabled />
            <p className="text-xs text-muted-foreground">{t('listing.custom.currencyHint')}</p>
          </div>

          <div className="space-y-1">
            <Label>
              {t('listing.sessions.shops')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {/* 🔴 Danh sách shop đến từ API — CHỈ những kết nối người dùng được phép thấy.
                Employee nhận đúng shop được gán; backend kiểm lại lần nữa khi tạo/sửa lượt. */}
            <ShopMultiSelect
              options={(shopFilters.data?.shops ?? []).map((shop) => ({
                id: shop.id,
                name: shop.name,
                connectionName: shop.connectionName,
              }))}
              value={form.shopIds}
              onChange={(shopIds) => patch({ shopIds })}
              loading={shopFilters.isLoading}
            />
          </div>
        </div>
      </Section>

      {/* ---------- 2. Thông tin sản phẩm ---------- */}
      <Section title={t('listing.custom.productInfo')}>
        <div className="space-y-1">
          <Label>
            {t('listing.manual.title')}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder={t('listing.manual.titlePlaceholder')}
          />
          <p
            className={cn(
              'text-right text-xs',
              form.title.length > TITLE_MAX ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {form.title.length} / {TITLE_MAX}
          </p>
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <Label>{t('listing.custom.searchTerms')}</Label>
            <Input
              value={form.searchTerms}
              onChange={(event) => patch({ searchTerms: event.target.value })}
              placeholder={t('listing.custom.searchTermsPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('listing.custom.searchTermsHint', { max: SEARCH_TERMS_MAX })}
            </p>
          </div>
          <div className="space-y-1">
            <Label>{t('listing.custom.highlights')}</Label>
            <textarea
              value={form.highlights}
              onChange={(event) => patch({ highlights: event.target.value })}
              rows={3}
              placeholder={t('listing.custom.highlightsPlaceholder')}
              className="w-full rounded-md border bg-background p-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('listing.custom.highlightsHint')}</p>
          </div>
        </div>
      </Section>

      {/* ---------- 3. Hình ảnh & Video ---------- */}
      <Section title={t('listing.media.section')}>
        <div className="mb-4 space-y-1">
          <Label>{t('listing.templatePicker.imageTemplate')}</Label>
          <TemplatePicker
            label={t('listing.templatePicker.imageTemplate')}
            options={(imageTemplates.data?.items ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              hint: t('listing.templatePicker.imageCount', { count: item.items?.length ?? 0 }),
            }))}
            loading={imageTemplates.isLoading}
            error={imageTemplates.isError}
            value={form.templates.image}
            onChange={(id) => setTemplate('image', id)}
            onApply={handleApplyImageTemplate}
            onRefresh={() => void imageTemplates.refetch()}
            refreshing={imageTemplates.isFetching}
            confirmMessage={form.images.length > 0 ? t('listing.templatePicker.confirmImages') : undefined}
          />
        </div>

        <MediaEditor
          images={form.images}
          onImagesChange={(images) => patch({ images })}
          sizeChart={form.sizeChart}
          onSizeChartChange={(sizeChart) => patch({ sizeChart })}
          video={form.video}
          onVideoChange={(video) => patch({ video })}
        />
      </Section>

      {/* ---------- 4. Danh mục & Thuộc tính ---------- */}
      <Section
        title={t('listing.custom.categorySection')}
        action={
          form.category.id ? (
            <Button
              variant="outline"
              size="sm"
              disabled={attributes.isFetching}
              onClick={() => void attributes.refetch()}
            >
              {attributes.isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t('listing.custom.refreshAttributes')}
            </Button>
          ) : undefined
        }
      >
        <div className="mb-4 space-y-1">
          <Label>{t('listing.templatePicker.categoryTemplate')}</Label>
          <TemplatePicker
            label={t('listing.templatePicker.categoryTemplate')}
            options={(categoryTemplates.data?.items ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              hint: item.categoryPath ?? item.categoryName,
              market: item.market,
            }))}
            loading={categoryTemplates.isLoading}
            error={categoryTemplates.isError}
            value={form.templates.category}
            onChange={(id) => setTemplate('category', id)}
            onApply={handleApplyCategoryTemplate}
            onRefresh={() => void categoryTemplates.refetch()}
            refreshing={categoryTemplates.isFetching}
            market={form.market}
            confirmMessage={form.category.id ? t('listing.templatePicker.confirmCategory') : undefined}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <Label>
              {t('listing.categoryTemplates.category')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {/* Tìm kiếm phía SERVER — cây danh mục TikTok có ~9.900 nút lá, không tải hết.
                Chọn xong là ghi cả mã + nhãn vào form; danh sách có dọn đi cũng không mất. */}
            <Combobox
              value={form.category.id}
              onChange={(value) => {
                const picked = (categories.data ?? []).find(
                  (item) => item.tiktokCategoryId === value,
                );
                patch({
                  category: {
                    id: value,
                    name: picked?.localName ?? (value === form.category.id ? form.category.name : ''),
                    path: picked?.path ?? (value === form.category.id ? form.category.path : ''),
                  },
                });
              }}
              onSearchChange={setCategorySearch}
              loading={categories.isFetching}
              options={categoryOptions}
              placeholder={t('listing.categoryTemplates.selectCategory')}
              searchPlaceholder={t('listing.categoryTemplates.searchCategory')}
            />
          </div>

          <div className="space-y-1">
            <Label>{t('listing.custom.warehouse')}</Label>
            {/* Kho là dữ liệu CỦA SHOP — chọn nhiều shop thì để trống, publisher tự quyết kho
                cho từng shop lúc đăng (xem `resolveWarehouse`). */}
            <Combobox
              value={form.warehouseId}
              onChange={(warehouseId) => patch({ warehouseId })}
              loading={warehouses.isFetching}
              disabled={form.shopIds.length !== 1}
              options={[
                { value: '', label: t('listing.custom.warehouseAuto') },
                ...(warehouses.data ?? []).map((warehouse) => ({
                  value: warehouse.id,
                  label: warehouse.name ?? warehouse.tiktokWarehouseId,
                })),
              ]}
            />
            {form.shopIds.length !== 1 && (
              <p className="text-xs text-muted-foreground">{t('listing.custom.warehouseHint')}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>{t('listing.categoryTemplates.brand')}</Label>
            <Combobox
              value={form.brand.id}
              onChange={(value) => {
                const picked = (brands.data?.items ?? []).find(
                  (brand) => brand.tiktokBrandId === value,
                );
                patch({
                  brand: {
                    id: value,
                    name: picked?.name ?? (value === form.brand.id ? form.brand.name : ''),
                  },
                });
              }}
              onSearchChange={setBrandSearch}
              loading={brands.isFetching}
              options={brandOptions}
              searchPlaceholder={t('listing.categoryTemplates.searchBrand')}
            />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium">{t('listing.categoryTemplates.attributes')}</p>
          {!form.category.id ? (
            <p className="text-sm text-muted-foreground">
              {t('listing.categoryTemplates.selectCategoryFirst')}
            </p>
          ) : attributes.isPending || attributes.isFetching ? (
            <p className="text-sm text-muted-foreground">
              {t('listing.categoryTemplates.loadingAttributes')}
            </p>
          ) : attributes.isError ? (
            <p className="text-sm text-destructive">
              {t('listing.categoryTemplates.attributesError')}
            </p>
          ) : (attributes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('listing.categoryTemplates.noAttributes')}
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(attributes.data ?? []).map((attribute) => (
                <div key={attribute.tiktokAttributeId} className="space-y-1">
                  <Label>
                    {attribute.name ?? attribute.tiktokAttributeId}
                    {attribute.isRequired && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {/* Render ĐỘNG theo metadata thật của TikTok — không hard-code trường nào. */}
                  <AttributeValuePicker
                    attribute={attribute}
                    selection={
                      form.attributeValues[attribute.tiktokAttributeId] ?? {
                        valueIds: [],
                        customValues: [],
                      }
                    }
                    onChange={(next) =>
                      setForm((prev) => ({
                        ...prev,
                        attributeValues: {
                          ...prev.attributeValues,
                          [attribute.tiktokAttributeId]: next,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* ---------- 5. Mô tả sản phẩm ---------- */}
      <Section title={t('listing.manual.description')}>
        <div className="mb-3 space-y-1">
          <Label>{t('listing.templatePicker.descriptionTemplate')}</Label>
          <TemplatePicker
            label={t('listing.templatePicker.descriptionTemplate')}
            options={(descriptionTemplates.data?.items ?? []).map((item) => ({
              id: item.id,
              name: item.name,
            }))}
            loading={descriptionTemplates.isLoading}
            error={descriptionTemplates.isError}
            value={form.templates.description}
            onChange={(id) => setTemplate('description', id)}
            onApply={handleApplyDescriptionTemplate}
            onRefresh={() => void descriptionTemplates.refetch()}
            refreshing={descriptionTemplates.isFetching}
            confirmMessage={
              form.description.trim() ? t('listing.templatePicker.confirmDescription') : undefined
            }
          />
        </div>

        {/* Ảnh chèn vào mô tả đi qua ĐÚNG Storage Module mà ảnh sản phẩm dùng — HTML lưu URL
            công khai của file, không base64, không đường dẫn máy. */}
        <RichTextEditor
          value={form.description}
          onChange={(description) => patch({ description })}
          minHeight="240px"
          placeholder={t('listing.manual.descriptionPlaceholder')}
          onUploadImage={async (file) => {
            const asset = await podListingService.uploadAsset(file);
            if (!asset.publicUrl) throw new Error('missing url');
            return { url: asset.publicUrl, alt: asset.originalName };
          }}
          onUploadingChange={setDescriptionUploading}
        />
        {/* Ảnh mô tả lúc đăng được upload lại lên TikTok với use_case DESCRIPTION_IMAGE và đổi src —
            ở đây chỉ giữ URL Storage để mở lại nháp vẫn thấy ảnh. */}
        <p className="mt-1 text-xs text-muted-foreground">{t('listing.custom.descriptionImageHint')}</p>
        <p
          className={cn(
            'mt-1 text-right text-xs',
            form.description.length > DESCRIPTION_MAX
              ? 'font-medium text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {form.description.length} / {DESCRIPTION_MAX}
        </p>
      </Section>

      {/* ---------- 6. Đóng gói ---------- */}
      <Section title={t('listing.custom.package')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PackageField
            label={t('listing.custom.weight')}
            required
            value={form.pkg.weight}
            onChange={(weight) => patch({ pkg: { ...form.pkg, weight } })}
          />
          <div className="space-y-1">
            <Label>{t('listing.custom.weightUnit')}</Label>
            <Combobox
              value={form.pkg.weightUnit}
              onChange={(weightUnit) => patch({ pkg: { ...form.pkg, weightUnit } })}
              options={['GRAM', 'KILOGRAM', 'POUND', 'OUNCE'].map((value) => ({
                value,
                label: value,
              }))}
            />
          </div>
          <div />
          <PackageField
            label={t('listing.custom.length')}
            value={form.pkg.length}
            onChange={(length) => patch({ pkg: { ...form.pkg, length } })}
          />
          <PackageField
            label={t('listing.custom.width')}
            value={form.pkg.width}
            onChange={(width) => patch({ pkg: { ...form.pkg, width } })}
          />
          <PackageField
            label={t('listing.custom.height')}
            value={form.pkg.height}
            onChange={(height) => patch({ pkg: { ...form.pkg, height } })}
          />
          <div className="space-y-1">
            <Label>{t('listing.custom.dimensionUnit')}</Label>
            <Combobox
              value={form.pkg.dimensionUnit}
              onChange={(dimensionUnit) => patch({ pkg: { ...form.pkg, dimensionUnit } })}
              options={['CENTIMETER', 'INCH'].map((value) => ({ value, label: value }))}
            />
          </div>
        </div>
      </Section>

      {/* ---------- 7. SKU & Giá bán ---------- */}
      <Section title={t('listing.manual.skuPricing')}>
        <div className="mb-4 space-y-1">
          <Label>{t('listing.templatePicker.skuTemplate')}</Label>
          <TemplatePicker
            label={t('listing.templatePicker.skuTemplate')}
            options={(skuTemplates.data?.items ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              hint: t('listing.templatePicker.skuCount', { count: item.items?.length ?? 0 }),
            }))}
            loading={skuTemplates.isLoading}
            error={skuTemplates.isError}
            value={form.templates.sku}
            onChange={(id) => setTemplate('sku', id)}
            onApply={handleApplySkuTemplate}
            onRefresh={() => void skuTemplates.refetch()}
            refreshing={skuTemplates.isFetching}
            confirmMessage={form.skus.length > 0 ? t('listing.templatePicker.confirmSku') : undefined}
          />
        </div>

        <VariationEditor
          variations={form.variations}
          onChange={(variations) => patch({ variations })}
        />

        <div className="my-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={generateSkus} disabled={pendingSkuCount === 0}>
            {t('listing.manual.generateSkus')}
          </Button>
          {pendingSkuCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('listing.manual.willGenerate', { count: pendingSkuCount })}
            </span>
          )}
        </div>

        {form.skus.length > 1 && (
          <div className="mb-3">
            <BulkSkuBar
              variants={form.skus.map((sku, index) => ({
                tiktokSkuId: skuKey(sku, index),
                variantName: sku.optionValues.map((option) => option.value).join(' / '),
              }))}
              onApply={applyBulk}
            />
          </div>
        )}

        <SkuEditor skus={form.skus} onChange={(skus) => patch({ skus })} currency={currency} />
      </Section>

      {/* ---------- Kết quả kiểm tra ---------- */}
      {issues !== null && (
        <Card className={cn(issues.length > 0 && 'border-destructive')}>
          <CardHeader>
            <p className="font-medium">
              {issues.length === 0
                ? t('listing.custom.validateOk')
                : t('listing.custom.validateFailed', { count: issues.length })}
            </p>
          </CardHeader>
          {issues.length > 0 && (
            <CardContent className="space-y-1">
              {issues.map((issue) => (
                <p key={`${issue.field}|${issue.message}`} className="text-sm">
                  <Badge variant="muted" className="mr-2 font-mono">
                    {issue.field}
                  </Badge>
                  {issue.message}
                </p>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* ---------- Thanh hành động ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-2">
          {form.shopIds.length > 0 && (
            <span className="mr-auto text-sm text-muted-foreground">
              {t('listing.custom.willListTo', { count: form.shopIds.length })}
            </span>
          )}
          <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
            {t('common:action.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleValidate()}
            disabled={busy || sessionLocked}
          >
            {validate.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {t('listing.custom.validate')}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleSaveDraft()}
            disabled={busy || sessionLocked}
          >
            <Save className="size-4" />
            {editing ? t('common:action.save') : t('listing.custom.saveDraft')}
          </Button>
          {/* Nút đăng chỉ hiện với người có quyền chạy listing — backend kiểm lại (§15). */}
          {canRun && (
            <Button onClick={() => void handleSubmit()} disabled={busy || sessionLocked}>
              {start.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              {t('listing.custom.submit')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Khoá ổn định cho một dòng SKU trên lưới (Seller SKU có thể trùng/rỗng lúc đang gõ). */
function skuKey(sku: ManualSku, index: number): string {
  return `${index}:${sku.optionValues.map((option) => option.value).join('/')}`;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Ô số của khu vực đóng gói — chỉ nhận số dương, chặn ngay tại chỗ gõ. */
function PackageField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const invalid = value.trim() !== '' && !(Number(value) > 0);
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        className={cn(invalid && 'border-destructive')}
      />
    </div>
  );
}
