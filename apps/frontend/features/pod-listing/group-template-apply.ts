import type { PodGroupTemplate, PodListingMarket } from './types';

/**
 * **Quy tắc áp Group Template** — DÙNG CHUNG cho Auto Listing và Custom Listing.
 *
 * Hai màn hình lưu dữ liệu khác nhau (Auto Listing giữ ID template con; Custom Listing chép
 * nội dung template vào form), nên mỗi bên có adapter riêng biến dữ liệu của mình thành
 * "dấu vân tay" từng khu vực. Còn quyết định khu vực nào bị thay / bị dọn / được giữ thì
 * chỉ nằm ở MỘT chỗ — hàm `planGroupApply` dưới đây.
 *
 * ```
 *   Khu vực      Group mới CÓ mảnh        Group mới KHÔNG có mảnh
 *   ─────────    ─────────────────        ───────────────────────────────────────────
 *   đang trống   set                      keep (vẫn trống)
 *   từ group cũ  set                      clear  ← không để sót dữ liệu của group cũ
 *   nhập tay     set  (hỏi xác nhận)      keep   ← không xoá công của người dùng
 *                keep nếu `keepManual` (Custom Listing mở lại từ nháp)
 * ```
 *
 * "Từ group cũ" = dữ liệu hiện tại TRÙNG KHÍT với thứ group trước đã điền (so dấu vân tay).
 * Người dùng sửa dù một ô sau khi áp thì khu vực đó thành "nhập tay".
 *
 * 🔴 Chỉ đụng 4 khu vực này. Tiêu đề, giá ngoài bảng SKU, shop, ghi chú… nằm ngoài phạm vi
 * group nên không bao giờ bị ghi đè.
 */

export const GROUP_SLOTS = ['category', 'sku', 'description', 'image'] as const;
export type GroupSlot = (typeof GROUP_SLOTS)[number];
export type GroupSlotAction = 'set' | 'clear' | 'keep';

/** Dấu vân tay mỗi khu vực. Chuỗi rỗng = khu vực trống. */
export type SlotFingerprints = Record<GroupSlot, string>;

export interface GroupApplyPlan {
  actions: Record<GroupSlot, GroupSlotAction>;
  /** Khu vực đang có dữ liệu NHẬP TAY sẽ bị thay — phải hỏi người dùng trước. */
  overwritesManual: GroupSlot[];
  /** Khu vực của group cũ bị dọn vì group mới không có mảnh đó. */
  cleared: GroupSlot[];
  /** Khu vực nhập tay được giữ nguyên vì group mới không có mảnh đó. */
  keptManual: GroupSlot[];
}

export function planGroupApply(input: {
  /** Group mới có mảnh nào. */
  provides: Record<GroupSlot, boolean>;
  /** Hiện trạng. */
  current: SlotFingerprints;
  /** Dấu vân tay mà group mới SẼ tạo ra (để không coi "đè bằng chính nó" là ghi đè). */
  next?: Partial<SlotFingerprints>;
  /** Dấu vân tay mà group áp TRƯỚC ĐÓ đã tạo ra. Không biết (vd vừa mở lại nháp) ⇒ bỏ trống. */
  previous?: Partial<SlotFingerprints> | null;
  /**
   * `true` ⇒ dữ liệu KHÔNG do group trước (trong phiên này) điền thì GIỮ NGUYÊN kể cả khi group
   * mới có mảnh đó — group chỉ điền khu vực còn trống. Dùng cho Custom Listing MỞ LẠI TỪ NHÁP:
   * không biết phần nào do group cũ điền, phần nào người dùng tự sửa ⇒ không đụng vào.
   */
  keepManual?: boolean;
}): GroupApplyPlan {
  const actions = {} as Record<GroupSlot, GroupSlotAction>;
  const overwritesManual: GroupSlot[] = [];
  const cleared: GroupSlot[] = [];
  const keptManual: GroupSlot[] = [];

  for (const slot of GROUP_SLOTS) {
    const current = input.current[slot];
    const fromPrevious = current !== '' && input.previous?.[slot] === current;

    if (input.provides[slot]) {
      const unchanged = input.next?.[slot] !== undefined && input.next[slot] === current;
      const manual = current !== '' && !fromPrevious && !unchanged;
      if (manual && input.keepManual) {
        actions[slot] = 'keep';
        keptManual.push(slot);
        continue;
      }
      actions[slot] = 'set';
      if (manual) overwritesManual.push(slot);
      continue;
    }

    if (current === '') {
      actions[slot] = 'keep';
    } else if (fromPrevious) {
      actions[slot] = 'clear';
      cleared.push(slot);
    } else {
      actions[slot] = 'keep';
      keptManual.push(slot);
    }
  }

  return { actions, overwritesManual, cleared, keptManual };
}

/** Group có mảnh nào — từ bản danh sách (tham chiếu). */
export function groupProvides(group: Pick<
  PodGroupTemplate,
  'categoryTemplateId' | 'skuTemplateId' | 'descriptionTemplateId' | 'imageTemplateId'
>): Record<GroupSlot, boolean> {
  return {
    category: Boolean(group.categoryTemplateId),
    sku: Boolean(group.skuTemplateId),
    description: Boolean(group.descriptionTemplateId),
    image: Boolean(group.imageTemplateId),
  };
}

// ---------------------------------------------------------------------------
// Adapter Auto Listing — lượt đăng giữ ID template con
// ---------------------------------------------------------------------------

/** Bộ ID template của một lượt đăng (đúng hình dạng `PodSessionTemplateSelection`). */
export interface SessionTemplateIds {
  categoryTemplateId?: string | null;
  skuTemplateId?: string | null;
  descriptionTemplateId?: string | null;
  imageTemplateId?: string | null;
  pricingStrategyId?: string | null;
  groupTemplateId?: string | null;
}

const SESSION_KEY: Record<GroupSlot, keyof SessionTemplateIds> = {
  category: 'categoryTemplateId',
  sku: 'skuTemplateId',
  description: 'descriptionTemplateId',
  image: 'imageTemplateId',
};

function sessionFingerprints(ids: SessionTemplateIds | PodGroupTemplate): SlotFingerprints {
  const read = (slot: GroupSlot) =>
    ((ids as unknown as Record<string, string | null | undefined>)[SESSION_KEY[slot]] ?? '') || '';
  return {
    category: read('category'),
    sku: read('sku'),
    description: read('description'),
    image: read('image'),
  };
}

/**
 * Áp group vào bộ template của Auto Listing.
 *
 * Dấu vân tay = chính ID template con: so với ID của group ĐANG chọn trước đó (lấy từ danh
 * sách group), nên biết được khu vực nào do group cũ điền kể cả sau khi mở lại lượt đăng.
 *
 * Thị trường: Category Template thuộc MỘT thị trường và backend từ chối lượt đăng lệch thị
 * trường ⇒ group có Category thì lượt đăng chuyển sang thị trường của nó (`market` trả về
 * khác `null` khi phải đổi — màn hình báo cho người dùng biết).
 */
export function applyGroupToSessionTemplates(input: {
  templates: SessionTemplateIds;
  market: PodListingMarket;
  group: PodGroupTemplate;
  previousGroup?: PodGroupTemplate | null;
}): { templates: SessionTemplateIds; market: PodListingMarket | null; plan: GroupApplyPlan } {
  const next = sessionFingerprints(input.group);
  const plan = planGroupApply({
    provides: groupProvides(input.group),
    current: sessionFingerprints(input.templates),
    next,
    previous: input.previousGroup ? sessionFingerprints(input.previousGroup) : null,
  });

  const templates: SessionTemplateIds = { ...input.templates, groupTemplateId: input.group.id };
  for (const slot of GROUP_SLOTS) {
    const key = SESSION_KEY[slot];
    if (plan.actions[slot] === 'set') templates[key] = next[slot];
    else if (plan.actions[slot] === 'clear') templates[key] = null;
  }

  const groupMarket = input.group.categoryTemplate?.market ?? null;
  const market = groupMarket && groupMarket !== input.market ? groupMarket : null;
  return { templates, market, plan };
}
