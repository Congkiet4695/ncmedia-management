'use client';

import { useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  VariationImagesDialog,
  type VariationImageMap,
} from '@/features/pod-listing/components/variation-images-dialog';
import { moveVariation } from '../manual-sku';
import type { ManualVariation, ManualVariationImage } from '../types';

/**
 * Trục biến thể: tên trục + danh sách giá trị.
 *
 * 🔴 Tách ra thành component riêng vì CẢ HAI lối vào dùng nó: form Custom Listing (màn hình
 * riêng) và dialog nhập tay trong lượt đăng. Chép hai bản là hai hành vi sẽ lệch nhau ngay
 * lần sửa đầu tiên (§16: logic chung phải dùng chung).
 *
 * Trục ĐẦU TIÊN có nút **Ảnh biến thể** — ảnh theo giá trị (Black → black.jpg), cùng dialog với
 * SKU Template. Theo VỊ TRÍ chứ không theo tên: xoá trục đầu thì trục kế tiếp là trục có ảnh.
 *
 * **Kéo thả đổi thứ tự trục** (tay cầm bên trái; bàn phím: Space nhấc, mũi tên, Space thả). Thứ tự
 * mới đi thẳng vào `variations` của form (không chỉ đổi giao diện) ⇒ lưu nháp, payload và thứ tự
 * `sales_attributes` gửi TikTok đều theo nó. Bảng SKU được đồng bộ bởi `reconcileSkus` ở form cha:
 * dòng giữ nguyên dữ liệu (danh tính = tổ hợp giá trị, không phải chỉ số).
 */
export function VariationEditor({
  variations,
  onChange,
  allowUrlImages,
}: {
  variations: ManualVariation[];
  onChange: (next: ManualVariation[]) => void;
  /** Cho nhập ảnh biến thể bằng URL (Custom Listing). */
  allowUrlImages?: boolean;
}) {
  const { t } = useTranslation('pod');
  const [imagesFor, setImagesFor] = useState<number | null>(null);
  const rowIds = useRowIds(variations.length);

  const patch = (index: number, next: Partial<ManualVariation>) =>
    onChange(variations.map((item, i) => (i === index ? { ...item, ...next } : item)));

  const remove = (index: number) => {
    rowIds.remove(index);
    onChange(variations.filter((_, i) => i !== index));
  };

  const add = () => {
    rowIds.append();
    onChange([...variations, { name: '', values: [] }]);
  };

  // Chuột: chỉ bắt đầu kéo sau 6px ⇒ bấm vào tay cầm không bị hiểu nhầm. Cảm ứng: giữ 200ms để
  // không cướp thao tác cuộn trang. Cùng cấu hình với kéo thả ảnh (`MediaEditor`).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rowIds.ids.indexOf(String(active.id));
    const to = rowIds.ids.indexOf(String(over.id));
    const next = moveVariation(variations, from, to);
    if (next === variations) return;
    rowIds.move(from, to);
    onChange(next);
  };

  const editing = imagesFor !== null ? variations[imagesFor] : undefined;

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rowIds.ids} strategy={verticalListSortingStrategy}>
          {variations.map((variation, index) => {
            const values = variation.values.map((value) => value.trim());
            const imageCount = (variation.images ?? []).filter((image) => values.includes(image.value)).length;
            const axisName = variation.name.trim() || t('listing.manual.variationName');
            return (
              <SortableVariationRow
                key={rowIds.ids[index]}
                id={rowIds.ids[index]}
                dragLabel={t('listing.manual.dragVariation', { name: axisName })}
                draggable={variations.length > 1}
              >
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
                      bấm thêm từng thẻ, và đây là thao tác lặp lại cả ngày. */}
                  <Input
                    value={variation.values.join(', ')}
                    placeholder="Black, White, Navy"
                    onChange={(event) =>
                      patch(index, { values: event.target.value.split(',').map((value) => value.trim()) })
                    }
                  />
                </div>
                {index === 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={values.filter(Boolean).length === 0}
                    title={t('listing.variantImages.firstAxisHint')}
                    onClick={() => setImagesFor(index)}
                  >
                    <ImageIcon className="size-4" />
                    {t('listing.variantImages.action')}
                    {imageCount > 0 && <span className="text-xs text-muted-foreground">({imageCount})</span>}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('listing.manual.removeVariation')}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
                {/* Trục đã có ảnh nhưng không còn đứng đầu: ảnh KHÔNG bị xoá (kéo lên đầu lại là
                    dùng lại), nhưng TikTok chỉ nhận ảnh ở trục đầu ⇒ nói rõ, không âm thầm bỏ. */}
                {index > 0 && imageCount > 0 && (
                  <p className="basis-full pl-7 text-xs text-amber-600 dark:text-amber-500">
                    {t('listing.manual.axisImagesInactive', { name: axisName, count: imageCount })}
                  </p>
                )}
              </SortableVariationRow>
            );
          })}
        </SortableContext>
      </DndContext>

      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="size-4" />
        {t('listing.manual.addVariation')}
      </Button>

      {editing && imagesFor !== null && (
        <VariationImagesDialog
          open
          axisName={editing.name.trim() || t('listing.manual.variationName')}
          values={editing.values.map((value) => value.trim()).filter(Boolean)}
          images={toImageMap(editing.images)}
          onChange={(next) => patch(imagesFor, { images: fromImageMap(next) })}
          onClose={() => setImagesFor(null)}
          allowUrlImages={allowUrlImages}
        />
      )}
    </div>
  );
}

function SortableVariationRow({
  id,
  dragLabel,
  draggable,
  children,
}: {
  id: string;
  dragLabel: string;
  draggable: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex flex-wrap items-end gap-2 rounded-md bg-background',
        isDragging && 'z-10 opacity-80 shadow-lg ring-2 ring-primary',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={!draggable}
        aria-label={dragLabel}
        title={dragLabel}
        className="mb-2 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
      >
        <GripVertical className="size-4" />
      </button>
      {children}
    </div>
  );
}

/**
 * Khoá React / dnd-kit ỔN ĐỊNH cho từng dòng trục — KHÔNG dùng chỉ số mảng: chỉ số đổi ngay khi kéo
 * thả, và khoá theo chỉ số làm React gắn nhầm trạng thái nội bộ (con trỏ gõ, IME) sang dòng khác.
 *
 * Khoá chỉ sống trong component (không vào `ManualVariation`) để payload / nháp không mang trường
 * lạ. Thao tác của chính editor (kéo, xoá, thêm) hoán vị khoá cùng lúc với dữ liệu; form cha thay
 * cả mảng (áp template, tải nháp) với số dòng khác ⇒ cắt / bổ sung khoá cho khớp.
 */
function useRowIds(count: number) {
  const seq = useRef(0);
  const nextId = () => {
    seq.current += 1;
    return `variation-${seq.current}`;
  };
  const [ids, setIds] = useState<string[]>(() => Array.from({ length: count }, nextId));

  let current = ids;
  if (ids.length !== count) {
    current = ids.length > count ? ids.slice(0, count) : [...ids, ...Array.from({ length: count - ids.length }, nextId)];
    setIds(current);
  }

  return {
    ids: current,
    move: (from: number, to: number) =>
      setIds((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      }),
    remove: (index: number) => setIds((prev) => prev.filter((_, i) => i !== index)),
    append: () => setIds((prev) => [...prev, nextId()]),
  };
}

/** `ManualVariationImage[]` (dạng lưu nháp) ⇄ map theo giá trị (dạng dialog dùng). */
function toImageMap(images: ManualVariationImage[] | undefined): VariationImageMap {
  return Object.fromEntries(
    (images ?? []).map((image) => [image.value, { fileId: image.fileId, url: image.url ?? null }]),
  );
}

function fromImageMap(map: VariationImageMap): ManualVariationImage[] {
  return Object.entries(map).map(([value, image]) => ({ value, fileId: image.fileId, url: image.url }));
}
