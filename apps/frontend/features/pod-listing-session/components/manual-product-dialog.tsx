'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useApiError } from '@/hooks/use-api-error';
import { cn } from '@/lib/utils';
import { buildSkuCombinations, countCombinations, reconcileSkus } from '../manual-sku';
import { useCreateSessionProduct, useUpdateSessionProduct } from '../hooks';
import type {
  ManualSku,
  ManualVariation,
  PodListingSessionDetail,
  PodSessionProduct,
} from '../types';

/** Trần TikTok cho `title` / `description` (Create Product). Chặn ngay tại chỗ gõ. */
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 10_000;
/** Trên ngưỡng này thì hỏi lại trước khi dựng lưới — 3 trục là ra hàng trăm dòng rất nhanh. */
const SKU_WARN_THRESHOLD = 200;

/**
 * Mỗi khu vực chạy ở một trong hai chế độ, chọn ĐỘC LẬP với các khu vực khác.
 *
 * 🔴 Đây là điểm cốt lõi của màn hình: không phải "nhập tay toàn bộ" hay "template toàn bộ".
 * Một sản phẩm có thể dùng Category Template chung của cả lượt nhưng mang mô tả và bảng giá
 * riêng — và đó chính là cách ảnh tham chiếu bố trí (mỗi section một dropdown mẫu, kèm lựa
 * chọn `NHẬP TAY`). Khu vực nào để ở TEMPLATE thì KHÔNG gửi trường đó lên, backend sẽ rơi về
 * template — xem `ManualListingData`.
 */
type SectionMode = 'TEMPLATE' | 'MANUAL';

/**
 * Form nhập tay MỘT sản phẩm cho lượt đăng nhiều shop.
 *
 * ```
 *   Form này  →  1 Draft Product (+ manualData)
 *                     ↓ Start Listing
 *                 fan-out (sản phẩm × MỌI shop của lượt)
 *                     ↓ Bulk Listing Engine đã có
 *                 hàng đợi · retry · kết quả theo TỪNG shop
 * ```
 *
 * 🔴 Form KHÔNG tự gọi TikTok và KHÔNG tự chọn shop: shop là thuộc tính của **lượt đăng**
 * (đã chọn ở phần cấu hình), và một sản phẩm luôn đi lên mọi shop của lượt. Nhờ vậy nhập một
 * lần là đăng được lên nhiều shop mà không phải nhập lại — đúng yêu cầu — và toàn bộ phần
 * chạy nền/ retry/ phân quyền theo shop dùng lại nguyên cỗ máy đang chạy.
 */
export function ManualProductDialog({
  open,
  session,
  product,
  onClose,
}: {
  open: boolean;
  session: PodListingSessionDetail;
  /** Có giá trị = sửa nháp đã lưu; `null` = thêm mới. */
  product: PodSessionProduct | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const create = useCreateSessionProduct();
  const update = useUpdateSessionProduct();
  const editorRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState('');
  const [descriptionMode, setDescriptionMode] = useState<SectionMode>('TEMPLATE');
  const [description, setDescription] = useState('');
  const [skuMode, setSkuMode] = useState<SectionMode>('TEMPLATE');
  const [variations, setVariations] = useState<ManualVariation[]>([]);
  const [skus, setSkus] = useState<ManualSku[]>([]);

  // Nạp lại nháp: mở form phải dựng đúng thứ đã lưu, kể cả chế độ của từng khu vực.
  // 🔴 Chế độ suy ra từ DỮ LIỆU (`manualData` có trường đó hay không), không lưu thành cờ
  // riêng — một cờ song song với dữ liệu là hai nguồn sự thật, và chúng sẽ lệch nhau.
  useEffect(() => {
    if (!open) return;
    const manual = product?.manualData ?? null;
    setTitle(product?.title ?? '');
    setDescriptionMode(manual?.description === undefined ? 'TEMPLATE' : 'MANUAL');
    setDescription(manual?.description ?? '');
    setSkuMode(manual?.skus === undefined ? 'TEMPLATE' : 'MANUAL');
    setVariations(manual?.variations ?? []);
    setSkus(manual?.skus ?? []);
  }, [open, product]);

  const pendingCount = useMemo(() => countCombinations(variations), [variations]);

  /**
   * Tên mẫu đang gắn cho một khu vực — để nút "Dùng mẫu" nói rõ ĐANG dùng mẫu nào.
   * "Dùng mẫu có sẵn" mà không cho biết mẫu nào thì người dùng vẫn phải đi chỗ khác tra.
   */
  const templateName = (type: 'DESCRIPTION' | 'SKU'): string =>
    session.templates.find((row) => row.templateType === type)?.templateName ??
    t('listing.manual.noTemplate');
  const saving = create.isPending || update.isPending;

  const generateSkus = () => {
    if (pendingCount === 0) {
      toast.error(t('listing.manual.needVariation'));
      return;
    }
    if (
      pendingCount > SKU_WARN_THRESHOLD &&
      !window.confirm(t('listing.manual.confirmManySkus', { count: pendingCount }))
    ) {
      return;
    }
    // `skus` hiện tại được truyền vào để giữ giá/Seller SKU người dùng đã gõ — xem
    // `buildSkuCombinations`. Bấm "Tạo SKU" lần hai KHÔNG được xoá công đã làm.
    setSkus(buildSkuCombinations(variations, skus));
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error(t('listing.manual.titleRequired'));
      return;
    }
    if (title.length > TITLE_MAX) {
      toast.error(t('listing.manual.titleTooLong', { max: TITLE_MAX }));
      return;
    }

    // Chỉ gửi khu vực đang ở chế độ NHẬP TAY. Khu vực để TEMPLATE mà vẫn gửi (dù là chuỗi
    // rỗng) sẽ bị backend hiểu là "cố ý xoá" và chặn listing — xem `applyManualOverride`.
    const manualData = {
      ...(descriptionMode === 'MANUAL' ? { description } : {}),
      ...(skuMode === 'MANUAL' ? { variations, skus } : {}),
    };

    try {
      if (product) {
        await update.mutateAsync({
          id: session.id,
          productId: product.id,
          payload: { title: title.trim(), manualData },
        });
      } else {
        await create.mutateAsync({
          id: session.id,
          payload: { title: title.trim(), manualData },
        });
      }
      toast.success(t('listing.manual.saved', { shops: session.shops.length }));
      onClose();
    } catch (error) {
      toast.error(t('listing.common.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-5xl"
      title={product ? t('listing.manual.edit') : t('listing.manual.create')}
      description={t('listing.manual.dialogHint', { count: session.shops.length })}
    >
      <div className="max-h-[74vh] space-y-5 overflow-y-auto pr-1">
        {/* --- Thị trường & Cửa hàng: CHỈ ĐỌC, thuộc về lượt đăng --- */}
        <Section title={t('listing.manual.marketShop')}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('listing.sessions.market')}:</span>
            <Badge variant="default">{session.market}</Badge>
            <span className="ml-3 text-muted-foreground">{t('listing.sessions.shops')}:</span>
            {session.shops.length === 0 ? (
              <span className="text-destructive">{t('listing.manual.noShop')}</span>
            ) : (
              session.shops.map((link) => (
                <Badge key={link.shopId} variant="muted">
                  {link.shop.name}
                </Badge>
              ))
            )}
          </div>
          {/* Nhắc rõ hệ quả TRƯỚC khi gõ, không phải sau khi bấm Đăng: cùng một nội dung sẽ
              lên tất cả các shop này. */}
          <p className="mt-2 text-xs text-muted-foreground">
            {t('listing.manual.shopHint', { count: session.shops.length })}
          </p>
        </Section>

        {/* --- Thông tin sản phẩm --- */}
        <Section title={t('listing.manual.productInfo')}>
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

        {/* --- Mô tả sản phẩm --- */}
        <Section
          title={t('listing.manual.description')}
          mode={descriptionMode}
          onModeChange={setDescriptionMode}
          templateLabel={templateName('DESCRIPTION')}
          t={t}
        >
          {descriptionMode === 'TEMPLATE' ? (
            <p className="text-sm text-muted-foreground">
              {t('listing.manual.usingTemplate', { name: templateName('DESCRIPTION') })}
            </p>
          ) : (
            <div ref={editorRef}>
              <RichTextEditor
                value={description}
                onChange={setDescription}
                minHeight="220px"
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
            </div>
          )}
        </Section>

        {/* --- SKU & Giá bán --- */}
        <Section
          title={t('listing.manual.skuPricing')}
          mode={skuMode}
          onModeChange={setSkuMode}
          templateLabel={templateName('SKU')}
          t={t}
        >
          {skuMode === 'TEMPLATE' ? (
            <p className="text-sm text-muted-foreground">
              {t('listing.manual.usingTemplate', { name: templateName('SKU') })}
            </p>
          ) : (
            <div className="space-y-4">
              {/* Đổi trục ⇒ bảng SKU đồng bộ ngay (cùng luật với form Custom Listing). */}
              <VariationEditor
                variations={variations}
                onChange={(next) => {
                  setSkus((prev) => reconcileSkus(variations, next, prev));
                  setVariations(next);
                }}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={generateSkus}>
                  <Sparkles className="size-4" />
                  {t('listing.manual.generateSkus')}
                </Button>
                {pendingCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t('listing.manual.willGenerate', { count: pendingCount })}
                  </span>
                )}
              </div>

              <SkuTable skus={skus} onChange={setSkus} />
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          {t('common:action.cancel')}
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('listing.manual.save')}
        </Button>
      </div>
    </Modal>
  );
}

/** Khung một khu vực, kèm công tắc "Dùng mẫu / Nhập tay" khi khu vực đó có hai chế độ. */
function Section({
  title,
  children,
  mode,
  onModeChange,
  templateLabel,
  t,
}: {
  title: string;
  children: React.ReactNode;
  mode?: SectionMode;
  onModeChange?: (mode: SectionMode) => void;
  templateLabel?: string;
  t?: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {mode && onModeChange && t && (
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <ModeButton
              active={mode === 'TEMPLATE'}
              onClick={() => onModeChange('TEMPLATE')}
              label={t('listing.manual.modeTemplate')}
              hint={templateLabel}
            />
            <ModeButton
              active={mode === 'MANUAL'}
              onClick={() => onModeChange('MANUAL')}
              label={t('listing.manual.modeManual')}
            />
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cn(
        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

/** Trục biến thể: tên trục + danh sách giá trị (nhập bằng dấu phẩy). */
function VariationEditor({
  variations,
  onChange,
}: {
  variations: ManualVariation[];
  onChange: (next: ManualVariation[]) => void;
}) {
  const { t } = useTranslation('pod');

  const patch = (index: number, next: Partial<ManualVariation>) =>
    onChange(variations.map((item, i) => (i === index ? { ...item, ...next } : item)));

  return (
    <div className="space-y-2">
      {variations.map((variation, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <div className="w-[180px] space-y-1">
            <Label>{t('listing.manual.variationName')}</Label>
            <Input
              value={variation.name}
              placeholder="Color"
              onChange={(event) => patch(index, { name: event.target.value })}
            />
          </div>
          <div className="min-w-[280px] flex-1 space-y-1">
            <Label>{t('listing.manual.variationValues')}</Label>
            {/* Nhập bằng dấu phẩy thay vì một ô tag: gõ "Black, White, Navy" nhanh hơn hẳn
                bấm thêm từng thẻ, và đây là thao tác người vận hành lặp lại cả ngày. */}
            <Input
              value={variation.values.join(', ')}
              placeholder="Black, White, Navy"
              onChange={(event) =>
                patch(index, { values: event.target.value.split(',').map((value) => value.trim()) })
              }
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('listing.manual.removeVariation')}
            onClick={() => onChange(variations.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...variations, { name: '', values: [] }])}
      >
        <Plus className="size-4" />
        {t('listing.manual.addVariation')}
      </Button>
    </div>
  );
}

/** Lưới SKU — mỗi dòng một tổ hợp, sửa được Seller SKU / giá / số lượng. */
function SkuTable({
  skus,
  onChange,
}: {
  skus: ManualSku[];
  onChange: (next: ManualSku[]) => void;
}) {
  const { t } = useTranslation('pod');

  if (skus.length === 0) {
    return (
      <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        {t('listing.manual.noSku')}
      </p>
    );
  }

  const patch = (index: number, next: Partial<ManualSku>) =>
    onChange(skus.map((item, i) => (i === index ? { ...item, ...next } : item)));

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">{t('listing.manual.variant')}</th>
            <th className="px-3 py-2 text-left">{t('listing.manual.sellerSku')}</th>
            <th className="px-3 py-2 text-left">{t('listing.manual.retailPrice')}</th>
            <th className="px-3 py-2 text-left">{t('listing.manual.listPrice')}</th>
            <th className="px-3 py-2 text-left">{t('listing.manual.quantity')}</th>
            <th className="w-[1%] px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {skus.map((sku, index) => (
            <tr key={`${sku.sellerSku}-${index}`} className="border-b last:border-0">
              <td className="whitespace-nowrap px-3 py-2 font-medium">
                {sku.optionValues.map((option) => option.value).join(' / ')}
              </td>
              <td className="px-3 py-2">
                <Input
                  value={sku.sellerSku}
                  className="h-8"
                  onChange={(event) => patch(index, { sellerSku: event.target.value })}
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  value={sku.salePrice ?? ''}
                  inputMode="decimal"
                  placeholder="19.99"
                  className="h-8 w-[100px]"
                  onChange={(event) => patch(index, { salePrice: event.target.value })}
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  value={sku.retailPrice ?? ''}
                  inputMode="decimal"
                  placeholder="29.99"
                  className="h-8 w-[100px]"
                  onChange={(event) => patch(index, { retailPrice: event.target.value })}
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  type="number"
                  min="0"
                  value={sku.quantity ?? 0}
                  className="h-8 w-[90px]"
                  onChange={(event) => patch(index, { quantity: Number(event.target.value) })}
                />
              </td>
              <td className="px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('listing.manual.removeSku')}
                  onClick={() => onChange(skus.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
