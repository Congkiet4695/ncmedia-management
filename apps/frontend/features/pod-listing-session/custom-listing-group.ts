import {
  GROUP_SLOTS,
  planGroupApply,
  type GroupApplyPlan,
  type GroupSlot,
  type SlotFingerprints,
} from '@/features/pod-listing/group-template-apply';
import type {
  PodCategoryTemplate,
  PodDescriptionTemplate,
  PodGroupTemplateResolved,
  PodImageTemplate,
  PodSkuTemplate,
} from '@/features/pod-listing/types';
import type { CustomListingForm } from './custom-listing-state';
import { applyCategoryTemplate, applyImageTemplate, applySkuTemplate } from './template-apply';

/**
 * Adapter **Custom Listing ⇄ template**: biến một template (lẻ hoặc từ Group Template) thành
 * trạng thái form mới.
 *
 * 🔴 Nút "Áp dụng" của từng khu vực VÀ việc áp Group Template đi qua CÙNG các hàm `with*`
 * dưới đây — áp Category từ group hay từ ô chọn Category Template ra đúng một kết quả. Hai
 * bản logic là cách chắc chắn để một bên quên mất bảng size hay giá trị thuộc tính.
 *
 * Tất cả là hàm THUẦN (kiểm bằng `scripts/verify-group-template.ts`).
 */

/** Category Template → market, danh mục (+ thuộc tính), brand, kho, kiện hàng, bảng size, video. */
export function withCategoryTemplate(
  form: CustomListingForm,
  template: PodCategoryTemplate,
): CustomListingForm {
  const applied = applyCategoryTemplate(template);
  return {
    ...form,
    templates: { ...form.templates, category: template.id },
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
    ...(applied.package ? { pkg: { ...form.pkg, ...applied.package } } : {}),
    ...(applied.sizeChartFileId
      ? {
          sizeChart: {
            imageUrl: '',
            fileId: applied.sizeChartFileId,
            imageType: 'SIZE_CHART' as const,
          },
        }
      : {}),
    ...(applied.videoFileId ? { video: { fileId: applied.videoFileId } } : {}),
  };
}

/** SKU Template (bản CHI TIẾT) → trục biến thể + bảng SKU với dữ liệu của từng tổ hợp. */
export function withSkuTemplate(form: CustomListingForm, template: PodSkuTemplate): CustomListingForm {
  const applied = applySkuTemplate(template);
  return {
    ...form,
    templates: { ...form.templates, sku: template.id },
    variations: applied.variations,
    skus: applied.skus,
  };
}

/** Description Template → HTML vào editor (giữ định dạng, sửa tiếp được). */
export function withDescriptionTemplate(
  form: CustomListingForm,
  template: PodDescriptionTemplate,
): CustomListingForm {
  return {
    ...form,
    templates: { ...form.templates, description: template.id },
    description: template.contentHtml,
  };
}

/** Image Template → bộ ảnh theo đúng thứ tự; `skipped` = số mục không có ảnh dùng được. */
export function withImageTemplate(
  form: CustomListingForm,
  template: PodImageTemplate,
): { form: CustomListingForm; skipped: number } {
  const applied = applyImageTemplate(template);
  return {
    form: { ...form, templates: { ...form.templates, image: template.id }, images: applied.images },
    skipped: applied.skipped,
  };
}

/**
 * Dọn MỘT khu vực về trống — dùng khi group mới không có mảnh mà group cũ đã điền.
 *
 * Category chỉ dọn danh mục + thuộc tính + mẫu đang chọn. Brand / kho / kiện hàng / bảng size
 * / video là các ô dùng chung mà người dùng hay chỉnh riêng — giữ nguyên.
 */
export function clearSlot(form: CustomListingForm, slot: GroupSlot): CustomListingForm {
  switch (slot) {
    case 'category':
      return {
        ...form,
        templates: { ...form.templates, category: '' },
        category: { id: '', name: '', path: '' },
        attributeValues: {},
      };
    case 'sku':
      return { ...form, templates: { ...form.templates, sku: '' }, variations: [], skus: [] };
    case 'description':
      return { ...form, templates: { ...form.templates, description: '' }, description: '' };
    case 'image':
      return { ...form, templates: { ...form.templates, image: '' }, images: [] };
  }
}

/**
 * Dấu vân tay từng khu vực của form — "dữ liệu khu vực này có còn y như lúc group điền không".
 * Chỉ gồm những gì người dùng nhìn thấy và sửa được ở khu vực đó.
 */
export function customSlotFingerprints(form: CustomListingForm): SlotFingerprints {
  const sku =
    form.variations.length === 0 && form.skus.length === 0
      ? ''
      : JSON.stringify({
          variations: form.variations.map((variation) => [
            variation.name,
            variation.values,
            (variation.images ?? []).map((image) => `${image.value}=${image.fileId}`),
          ]),
          skus: form.skus.map((sku) => [
            sku.sellerSku,
            sku.optionValues.map((option) => `${option.name}=${option.value}`),
            sku.salePrice,
            sku.retailPrice,
            sku.quantity ?? null,
            sku.barcode ?? null,
          ]),
        });

  return {
    category: form.category.id,
    sku,
    description: form.description.trim(),
    image: form.images.map((image) => image.fileId || image.imageUrl).join('|'),
  };
}

export interface CustomGroupApplyResult {
  form: CustomListingForm;
  /** `false` ⇒ group không điền / dọn được khu vực nào (form giữ nguyên, kể cả nhãn group). */
  changed: boolean;
  plan: GroupApplyPlan;
  /** Dấu vân tay các khu vực group VỪA điền — truyền lại làm `previous` cho lần đổi group sau. */
  applied: Partial<SlotFingerprints>;
  /** Số ảnh của Image Template bị bỏ vì không có URL dùng được. */
  skippedImages: number;
}

/**
 * Áp Group Template (bản resolved) vào form Custom Listing theo quy tắc chung
 * `planGroupApply`: khu vực group có ⇒ thay; khu vực group không có ⇒ dọn nếu là dữ liệu của
 * group trước, giữ nếu là dữ liệu nhập tay. Mọi trường ngoài 4 khu vực giữ nguyên.
 *
 * `previous` = `applied` của lần áp group trước trong phiên làm việc này. Không có (vừa mở lại
 * nháp) ⇒ không biết khu vực nào do group cũ điền ⇒ không dọn gì (an toàn: không xoá nhầm).
 *
 * `keepManual` (Custom Listing MỞ LẠI TỪ NHÁP): dữ liệu đang có mà không phải do group áp trong
 * phiên này điền thì GIỮ NGUYÊN — group chỉ điền khu vực còn trống. Tạo mới thì `false`: thay
 * sau khi người dùng xác nhận (hành vi cũ, không đổi).
 */
export function applyGroupToCustomForm(
  form: CustomListingForm,
  group: PodGroupTemplateResolved,
  previous?: Partial<SlotFingerprints> | null,
  options: { keepManual?: boolean } = {},
): CustomGroupApplyResult {
  // Mỗi mảnh áp RIÊNG lên form gốc — vừa để biết "đè bằng chính nó" không phải ghi đè, vừa để
  // khu vực được giữ không bị lẫn dữ liệu của group mới.
  const appliers: Partial<Record<GroupSlot, (base: CustomListingForm) => CustomListingForm>> = {};
  let skippedImages = 0;
  if (group.categoryTemplate) {
    const template = group.categoryTemplate;
    appliers.category = (base) => withCategoryTemplate(base, template);
  }
  if (group.skuTemplate) {
    const template = group.skuTemplate;
    appliers.sku = (base) => withSkuTemplate(base, template);
  }
  if (group.descriptionTemplate) {
    const template = group.descriptionTemplate;
    appliers.description = (base) => withDescriptionTemplate(base, template);
  }
  if (group.imageTemplate) {
    const template = group.imageTemplate;
    appliers.image = (base) => {
      const result = withImageTemplate(base, template);
      skippedImages = result.skipped;
      return result.form;
    };
  }

  const next: Partial<SlotFingerprints> = {};
  for (const slot of GROUP_SLOTS) {
    const apply = appliers[slot];
    if (apply) next[slot] = customSlotFingerprints(apply(form))[slot];
  }

  const plan = planGroupApply({
    provides: {
      category: Boolean(appliers.category),
      sku: Boolean(appliers.sku),
      description: Boolean(appliers.description),
      image: Boolean(appliers.image),
    },
    current: customSlotFingerprints(form),
    next,
    previous,
    keepManual: options.keepManual,
  });

  skippedImages = 0;
  // Nhãn group chỉ đổi khi group THỰC SỰ điền / dọn được gì đó — không gắn nhãn group mới lên
  // một form mà mọi khu vực vẫn là dữ liệu cũ (nhãn phải khớp dữ liệu thật).
  const changed = GROUP_SLOTS.some((slot) => plan.actions[slot] !== 'keep');
  let result: CustomListingForm = changed
    ? { ...form, templates: { ...form.templates, group: group.id } }
    : form;
  for (const slot of GROUP_SLOTS) {
    const apply = appliers[slot];
    if (plan.actions[slot] === 'set' && apply) result = apply(result);
    else if (plan.actions[slot] === 'clear') result = clearSlot(result, slot);
  }
  const nextForm = result;

  const fingerprints = customSlotFingerprints(nextForm);
  const applied: Partial<SlotFingerprints> = {};
  for (const slot of GROUP_SLOTS) {
    if (plan.actions[slot] === 'set') applied[slot] = fingerprints[slot];
  }

  return { form: nextForm, changed, plan, applied, skippedImages };
}
