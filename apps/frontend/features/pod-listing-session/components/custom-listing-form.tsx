'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, RefreshCw, Rocket, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  AttributeValuePicker,
  type AttributeSelection,
} from '@/features/pod-listing/components/attribute-value-picker';
import {
  useCategoryAttributes,
  usePodTemplates,
  useSyncedBrands,
  useSyncedCategories,
  useWarehouses,
} from '@/features/pod-listing/hooks/use-pod-listing';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';
import { buildSkuCombinations, countCombinations } from '../manual-sku';
import { useCreateCustomListing, useStartSessionListing, useValidateSession } from '../hooks';
import { POD_LISTING_MARKETS, type PodListingMarket } from '@/features/pod-listing/types';
import type {
  PodCategoryTemplate,
  PodDescriptionTemplate,
  PodImageTemplate,
  PodSkuTemplate,
} from '@/features/pod-listing/types';
import type { ManualSku, ManualVariation, ManualVideo, SessionImageInput } from '../types';
import {
  applyCategoryTemplate,
  applyImageTemplate,
  applySkuTemplate,
} from '../template-apply';
import { MEDIA_LIMITS, MediaEditor } from './media-editor';
import { TemplatePicker } from './template-picker';
import { ShopMultiSelect } from './shop-multi-select';
import { SkuEditor } from './sku-editor';
import { VariationEditor } from './variation-editor';

/** Trần TikTok (Create Product). Chặn ngay tại chỗ gõ, không đợi tới lúc gọi API. */
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 10_000;

/**
 * 🔴 Dùng ĐÚNG enum `PodListingMarket` của hệ thống (18 thị trường thật), KHÔNG phải cặp
 * "US / NON-US" của ảnh tham chiếu. Gộp 17 thị trường thành một nhãn "NON-US" nghe gọn nhưng
 * cây danh mục, thương hiệu và kho của TikTok khác nhau theo TỪNG thị trường — gộp lại là
 * đăng hàng bằng dữ liệu của một nước khác.
 */
const MARKETS = POD_LISTING_MARKETS;

/**
 * **Add Custom Listing** — nhập tay MỘT sản phẩm rồi đăng lên NHIỀU shop.
 *
 * ```
 *   Form  →  POST /pod/listing-sessions/custom   (lượt đăng + 1 Draft Product)
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
 * 🔴 Mỗi khu vực chọn ĐỘC LẬP "Dùng mẫu có sẵn" hay "Nhập tay" — đúng như ảnh tham chiếu,
 * nơi mỗi section có dropdown mẫu riêng kèm lựa chọn `NHẬP TAY`. Khu vực để ở chế độ mẫu thì
 * KHÔNG gửi trường đó lên, backend rơi về template.
 */
export function CustomListingForm() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canRun = hasPermission('pod.listing.run');

  const createCustom = useCreateCustomListing();
  const validate = useValidateSession();
  const start = useStartSessionListing();

  // --- Market & Shop ---
  const [market, setMarket] = useState<PodListingMarket>('US');
  const [shopIds, setShopIds] = useState<string[]>([]);

  // --- Thông tin sản phẩm ---
  const [title, setTitle] = useState('');

  // --- Danh mục & thuộc tính ---
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [attributeValues, setAttributeValues] = useState<Record<string, AttributeSelection>>({});
  const [brandId, setBrandId] = useState('');
  const [brandSearch, setBrandSearch] = useState('');

  // --- Mô tả ---
  const [description, setDescription] = useState('');

  // --- Đóng gói ---
  const [pkg, setPkg] = useState({
    weight: '',
    weightUnit: 'GRAM',
    length: '',
    width: '',
    height: '',
    dimensionUnit: 'CENTIMETER',
  });

  // --- Ảnh · Bảng size · Video ---
  const [images, setImages] = useState<SessionImageInput[]>([]);
  const [sizeChart, setSizeChart] = useState<SessionImageInput | null>(null);
  const [video, setVideo] = useState<ManualVideo | null>(null);

  // --- SKU ---
  const [variations, setVariations] = useState<ManualVariation[]>([]);
  const [skus, setSkus] = useState<ManualSku[]>([]);

  const [warehouseId, setWarehouseId] = useState('');
  /**
   * Mã danh mục TikTok từ template, đang chờ tra ra UUID nội bộ.
   *
   * 🔴 Category Template lưu `tiktok_category_id` (dùng lại được cho mọi shop cùng thị
   * trường), còn ô chọn danh mục của form làm việc bằng UUID nội bộ. Hai không gian id khác
   * nhau nên phải tra một nhịp — endpoint `categories?tiktokCategoryId=` đã có sẵn cho
   * đúng việc này (xem `PodProductController.findCategories`).
   */
  const [pendingCategoryTiktokId, setPendingCategoryTiktokId] = useState('');
  /** Mẫu đang CHỌN ở từng khu vực. Chọn ≠ áp dụng — xem `TemplatePicker`. */
  const [picked, setPicked] = useState({
    category: '',
    description: '',
    sku: '',
    image: '',
  });

  const [issues, setIssues] = useState<Array<{ field: string; message: string }> | null>(null);

  /**
   * Danh sách shop chọn được.
   *
   * 🔴 Dùng LẠI `GET /pod/products/filters` — endpoint này đã trả về đúng tập shop mà người
   * dùng được phép thấy (`PodAccessScopeService` lọc sẵn), kèm Connection Name. Tạo thêm một
   * endpoint "shop của tôi" là nhân bản đúng phép lọc phân quyền đó ra chỗ thứ hai.
   */
  const shopFilters = usePodProductFilters();
  const categories = useSyncedCategories({ search: categorySearch || undefined, leafOnly: true });
  // 🔴 Thuộc tính nạp theo danh mục ĐANG chọn. Backend tự hỏi TikTok nếu kho chưa có (xem
  // `PodProductService.findCategoryAttributes`) — nên không cần nút "đồng bộ" riêng ở đây,
  // và người dùng không phải có quyền master data.
  const attributes = useCategoryAttributes(categoryId || undefined);
  const brands = useSyncedBrands({ keyword: brandSearch || undefined, limit: 50 });
  const warehouses = useWarehouses(shopIds.length === 1 ? { shopId: shopIds[0] } : {});
  // Tra UUID nội bộ của danh mục mà Category Template khai. Chỉ chạy khi thật sự có mã.
  const templateCategory = useSyncedCategories(
    pendingCategoryTiktokId ? { tiktokCategoryId: pendingCategoryTiktokId } : { tiktokCategoryId: undefined },
  );

  // Template của tổ chức — nạp một lần, lọc tại chỗ trong `TemplatePicker`.
  const categoryTemplates = usePodTemplates<PodCategoryTemplate>('categories', { limit: 100 });
  const descriptionTemplates = usePodTemplates<PodDescriptionTemplate>('descriptions', { limit: 100 });
  const skuTemplates = usePodTemplates<PodSkuTemplate>('skus', { limit: 100 });
  const imageTemplates = usePodTemplates<PodImageTemplate>('images', { limit: 100 });

  /**
   * Áp Category Template — điền market, danh mục, brand, kho, đóng gói, bảng size, video.
   *
   * 🔴 Chỉ ghi những trường template THỰC SỰ khai (`applyCategoryTemplate` trả `undefined`
   * cho phần còn lại), nên áp một mẫu chỉ khai danh mục sẽ KHÔNG xoá kho người dùng đã chọn.
   */
  const handleApplyCategoryTemplate = (id: string) => {
    const template = categoryTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    const patch = applyCategoryTemplate(template);

    if (patch.market) setMarket(patch.market);
    if (patch.categoryTiktokId) {
      setPendingCategoryTiktokId(patch.categoryTiktokId);
    }
    if (patch.brandId !== undefined) setBrandId(patch.brandId);
    if (patch.warehouseId) setWarehouseId(patch.warehouseId);
    if (patch.package) setPkg((prev) => ({ ...prev, ...patch.package }));
    if (patch.sizeChartFileId) {
      setSizeChart({ imageUrl: '', fileId: patch.sizeChartFileId, imageType: 'SIZE_CHART' });
    }
    if (patch.videoFileId) setVideo({ fileId: patch.videoFileId });

    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const handleApplyDescriptionTemplate = (id: string) => {
    const template = descriptionTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    // Nạp HTML vào editor — giữ nguyên định dạng, người dùng sửa tiếp được.
    setDescription(template.contentHtml);
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const handleApplySkuTemplate = (id: string) => {
    const template = skuTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    const applied = applySkuTemplate(template);
    setVariations(applied.variations);
    // Mẫu đã sinh tổ hợp thì lấy nguyên bảng giá của nó; chưa sinh thì để người dùng bấm
    // "Tạo SKU" — không tự sinh thay họ, vì số tổ hợp có thể rất lớn.
    setSkus(applied.skus);
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  const handleApplyImageTemplate = (id: string) => {
    const template = imageTemplates.data?.items.find((item) => item.id === id);
    if (!template) return;
    const applied = applyImageTemplate(template);
    setImages(applied.images);
    if (applied.skipped > 0) {
      toast.warning(t('listing.templatePicker.imagesSkipped', { count: applied.skipped }));
    }
    toast.success(t('listing.templatePicker.applied', { name: template.name }));
  };

  /**
   * Đổi danh mục ⇒ XOÁ giá trị thuộc tính cũ.
   *
   * 🔴 Giữ lại là gửi lên TikTok thuộc tính của một danh mục khác — API từ chối, hoặc tệ hơn
   * là nhận rồi hiển thị sai. Xoá ở đây thay vì lúc submit để người dùng thấy ngay form trống.
   */
  useEffect(() => {
    setAttributeValues({});
  }, [categoryId]);

  // Tra xong ⇒ chọn đúng danh mục đó rồi dọn cờ chờ. Không tra được (danh mục đã bị gỡ khỏi
  // cây TikTok) thì báo rõ thay vì để ô danh mục trống một cách khó hiểu.
  useEffect(() => {
    if (!pendingCategoryTiktokId || templateCategory.isFetching) return;
    const found = templateCategory.data?.[0];
    if (found) setCategoryId(found.id);
    else toast.warning(t('listing.templatePicker.categoryGone', { id: pendingCategoryTiktokId }));
    setPendingCategoryTiktokId('');
  }, [pendingCategoryTiktokId, templateCategory.data, templateCategory.isFetching, t]);

  const pendingSkuCount = useMemo(() => countCombinations(variations), [variations]);
  const busy = createCustom.isPending || validate.isPending || start.isPending;

  /** Cảnh báo rời trang khi còn dữ liệu chưa lưu (§17). */
  useEffect(() => {
    const dirty = Boolean(
      title.trim() || description.trim() || skus.length > 0 || images.length > 0 || video,
    );
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [title, description, skus.length, images.length, video]);

  const selectedCategory = categories.data?.find((item) => item.id === categoryId);

  /** Dữ liệu nhập tay gửi lên — chỉ gồm khu vực người dùng thực sự điền. */
  const buildManualData = () => ({
    ...(description.trim() ? { description } : {}),
    ...(selectedCategory
      ? {
          category: {
            tiktokCategoryId: selectedCategory.tiktokCategoryId,
            name: selectedCategory.localName,
            path: selectedCategory.path,
          },
        }
      : {}),
    ...(brandId ? { brand: { tiktokBrandId: brandId } } : {}),
    ...((attributes.data ?? []).length > 0
      ? {
          attributes: (attributes.data ?? []).map((attribute) => {
            const entry = attributeValues[attribute.tiktokAttributeId] ?? {
              valueIds: [],
              customValues: [],
            };
            return {
              tiktokAttributeId: attribute.tiktokAttributeId,
              name: attribute.name ?? undefined,
              type: attribute.type ?? undefined,
              isRequired: attribute.isRequired,
              values: entry.valueIds.map((id) => ({
                id,
                name: attribute.values?.find((value) => value.id === id)?.name,
              })),
              customValues: entry.customValues,
            };
          }),
        }
      : {}),
    ...(pkg.weight.trim() ? { package: pkg } : {}),
    ...(video ? { video } : {}),
    ...(skus.length > 0 ? { variations, skus } : {}),
  });

  /** Tạo lượt đăng + sản phẩm. Trả về session id để bước sau dùng. */
  const persist = async (): Promise<string | null> => {
    if (!title.trim()) {
      toast.error(t('listing.manual.titleRequired'));
      return null;
    }
    if (title.length > TITLE_MAX) {
      toast.error(t('listing.manual.titleTooLong', { max: TITLE_MAX }));
      return null;
    }
    if (shopIds.length === 0) {
      toast.error(t('listing.custom.needShop'));
      return null;
    }
    // Cảnh báo, KHÔNG chặn: bộ ảnh có thể đến từ Image Template của lượt đăng, và cổng
    // Validate của backend mới là nơi phán quyết cuối cùng.
    if (images.length > 0 && images.length < MEDIA_LIMITS.IMAGE_MIN_RECOMMENDED) {
      toast.warning(
        t('listing.media.fewImages', { count: images.length, min: MEDIA_LIMITS.IMAGE_MIN_RECOMMENDED }),
      );
    }

    try {
      const session = await createCustom.mutateAsync({
        market,
        shopIds,
        product: {
          title: title.trim(),
          // 🔴 Bảng size đi CHUNG mảng `images` nhưng mang `imageType = SIZE_CHART`;
          // resolver tách nó ra khỏi bộ ảnh sản phẩm và gửi vào `size_chart` của TikTok.
          images: [...images, ...(sizeChart ? [sizeChart] : [])].map((image, index) => ({
            imageUrl: image.imageUrl,
            imageType: image.imageType,
            fileId: image.fileId,
            sortOrder: index,
          })),
          manualData: buildManualData(),
        },
      });
      return session.id;
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
      return null;
    }
  };

  const handleSaveDraft = async () => {
    const id = await persist();
    if (!id) return;
    toast.success(t('listing.custom.draftSaved'));
    router.push(`/dashboard/pod/auto-listing/${id}`);
  };

  const handleValidate = async () => {
    const id = await persist();
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
    if (!window.confirm(t('listing.custom.confirmSubmit', { count: shopIds.length }))) return;
    const id = await persist();
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

  return (
    <div className="space-y-4 pb-24">
      {/* ---------- 1. Thị trường & Cửa hàng ---------- */}
      <Section title={t('listing.custom.marketShop')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <Label>
              {t('listing.sessions.market')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Combobox
              value={market}
              onChange={(value) => setMarket(value as PodListingMarket)}
              options={MARKETS.map((value) => ({ value, label: value }))}
            />
            <p className="text-xs text-muted-foreground">{t('listing.custom.marketHint')}</p>
          </div>

          <div className="space-y-1">
            <Label>
              {t('listing.sessions.shops')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {/* 🔴 Danh sách shop đến từ API — CHỈ những kết nối người dùng được phép thấy.
                Employee nhận đúng shop được gán; backend kiểm lại lần nữa khi tạo lượt. */}
            <ShopMultiSelect
              options={(shopFilters.data?.shops ?? []).map((shop) => ({
                id: shop.id,
                name: shop.name,
                connectionName: shop.connectionName,
              }))}
              value={shopIds}
              onChange={setShopIds}
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
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('listing.manual.titlePlaceholder')}
          />
          <p
            className={cn(
              'text-right text-xs',
              title.length > TITLE_MAX ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {title.length} / {TITLE_MAX}
          </p>
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
            value={picked.image}
            onChange={(id) => setPicked((prev) => ({ ...prev, image: id }))}
            onApply={handleApplyImageTemplate}
            onRefresh={() => void imageTemplates.refetch()}
            refreshing={imageTemplates.isFetching}
            confirmMessage={images.length > 0 ? t('listing.templatePicker.confirmImages') : undefined}
          />
        </div>

        <MediaEditor
          images={images}
          onImagesChange={setImages}
          sizeChart={sizeChart}
          onSizeChartChange={setSizeChart}
          video={video}
          onVideoChange={setVideo}
        />
      </Section>

      {/* ---------- 4. Danh mục & Thuộc tính ---------- */}
      <Section
        title={t('listing.custom.categorySection')}
        action={
          categoryId ? (
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
            value={picked.category}
            onChange={(id) => setPicked((prev) => ({ ...prev, category: id }))}
            onApply={handleApplyCategoryTemplate}
            onRefresh={() => void categoryTemplates.refetch()}
            refreshing={categoryTemplates.isFetching}
            market={market}
            confirmMessage={categoryId ? t('listing.templatePicker.confirmCategory') : undefined}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1">
            <Label>
              {t('listing.categoryTemplates.category')}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            {/* Tìm kiếm phía SERVER — cây danh mục TikTok có ~9.900 nút lá, không tải hết. */}
            <Combobox
              value={categoryId}
              onChange={setCategoryId}
              onSearchChange={setCategorySearch}
              loading={categories.isFetching}
              options={(categories.data ?? []).map((item) => ({
                value: item.id,
                label: item.path ?? item.localName ?? item.tiktokCategoryId,
              }))}
              searchPlaceholder={t('listing.categoryTemplates.searchCategory')}
            />
          </div>

          <div className="space-y-1">
            <Label>{t('listing.custom.warehouse')}</Label>
            {/* Kho là dữ liệu CỦA SHOP — chọn nhiều shop thì để trống, publisher tự quyết kho
                cho từng shop lúc đăng (xem `resolveWarehouse`). */}
            <Combobox
              value={warehouseId}
              onChange={setWarehouseId}
              loading={warehouses.isFetching}
              disabled={shopIds.length !== 1}
              options={[
                { value: '', label: t('listing.custom.warehouseAuto') },
                ...(warehouses.data ?? []).map((warehouse) => ({
                  value: warehouse.id,
                  label: warehouse.name ?? warehouse.tiktokWarehouseId,
                })),
              ]}
            />
            {shopIds.length !== 1 && (
              <p className="text-xs text-muted-foreground">{t('listing.custom.warehouseHint')}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>{t('listing.categoryTemplates.brand')}</Label>
            <Combobox
              value={brandId}
              onChange={setBrandId}
              onSearchChange={setBrandSearch}
              loading={brands.isFetching}
              options={[
                { value: '', label: t('listing.categoryTemplates.noBrand') },
                ...(brands.data?.items ?? []).map((brand) => ({
                  value: brand.tiktokBrandId,
                  label: brand.name ?? brand.tiktokBrandId,
                })),
              ]}
              searchPlaceholder={t('listing.categoryTemplates.searchBrand')}
            />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium">{t('listing.categoryTemplates.attributes')}</p>
          {!categoryId ? (
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
                      attributeValues[attribute.tiktokAttributeId] ?? {
                        valueIds: [],
                        customValues: [],
                      }
                    }
                    onChange={(next) =>
                      setAttributeValues((prev) => ({
                        ...prev,
                        [attribute.tiktokAttributeId]: next,
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
            value={picked.description}
            onChange={(id) => setPicked((prev) => ({ ...prev, description: id }))}
            onApply={handleApplyDescriptionTemplate}
            onRefresh={() => void descriptionTemplates.refetch()}
            refreshing={descriptionTemplates.isFetching}
            confirmMessage={
              description.trim() ? t('listing.templatePicker.confirmDescription') : undefined
            }
          />
        </div>

        <RichTextEditor
          value={description}
          onChange={setDescription}
          minHeight="240px"
          placeholder={t('listing.manual.descriptionPlaceholder')}
        />
        <p
          className={cn(
            'mt-1 text-right text-xs',
            description.length > DESCRIPTION_MAX
              ? 'font-medium text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {description.length} / {DESCRIPTION_MAX}
        </p>
      </Section>

      {/* ---------- 6. Đóng gói ---------- */}
      <Section title={t('listing.custom.package')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PackageField
            label={t('listing.custom.weight')}
            required
            value={pkg.weight}
            onChange={(value) => setPkg((prev) => ({ ...prev, weight: value }))}
          />
          <div className="space-y-1">
            <Label>{t('listing.custom.weightUnit')}</Label>
            <Combobox
              value={pkg.weightUnit}
              onChange={(value) => setPkg((prev) => ({ ...prev, weightUnit: value }))}
              options={['GRAM', 'KILOGRAM', 'POUND', 'OUNCE'].map((value) => ({
                value,
                label: value,
              }))}
            />
          </div>
          <div />
          <PackageField
            label={t('listing.custom.length')}
            value={pkg.length}
            onChange={(value) => setPkg((prev) => ({ ...prev, length: value }))}
          />
          <PackageField
            label={t('listing.custom.width')}
            value={pkg.width}
            onChange={(value) => setPkg((prev) => ({ ...prev, width: value }))}
          />
          <PackageField
            label={t('listing.custom.height')}
            value={pkg.height}
            onChange={(value) => setPkg((prev) => ({ ...prev, height: value }))}
          />
          <div className="space-y-1">
            <Label>{t('listing.custom.dimensionUnit')}</Label>
            <Combobox
              value={pkg.dimensionUnit}
              onChange={(value) => setPkg((prev) => ({ ...prev, dimensionUnit: value }))}
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
            value={picked.sku}
            onChange={(id) => setPicked((prev) => ({ ...prev, sku: id }))}
            onApply={handleApplySkuTemplate}
            onRefresh={() => void skuTemplates.refetch()}
            refreshing={skuTemplates.isFetching}
            confirmMessage={skus.length > 0 ? t('listing.templatePicker.confirmSku') : undefined}
          />
        </div>

        <VariationEditor variations={variations} onChange={setVariations} />

        <div className="my-3 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSkus(buildSkuCombinations(variations, skus))}
            disabled={pendingSkuCount === 0}
          >
            {t('listing.manual.generateSkus')}
          </Button>
          {pendingSkuCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('listing.manual.willGenerate', { count: pendingSkuCount })}
            </span>
          )}
        </div>

        <SkuEditor skus={skus} onChange={setSkus} />
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
          {shopIds.length > 0 && (
            <span className="mr-auto text-sm text-muted-foreground">
              {t('listing.custom.willListTo', { count: shopIds.length })}
            </span>
          )}
          <Button variant="ghost" onClick={() => router.back()} disabled={busy}>
            {t('common:action.cancel')}
          </Button>
          <Button variant="outline" onClick={() => void handleValidate()} disabled={busy}>
            {validate.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {t('listing.custom.validate')}
          </Button>
          <Button variant="outline" onClick={() => void handleSaveDraft()} disabled={busy}>
            <Save className="size-4" />
            {t('listing.custom.saveDraft')}
          </Button>
          {/* Nút đăng chỉ hiện với người có quyền chạy listing — backend kiểm lại (§15). */}
          {canRun && (
            <Button onClick={() => void handleSubmit()} disabled={busy}>
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
