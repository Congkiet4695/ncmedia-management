import {
  emptyCustomListingForm,
  type CustomListingForm,
} from './custom-listing-state';
import { suggestSellerSku, type SkuBuildOptions } from './manual-sku';
import type { ManualAttribute, ManualSku } from './types';

/**
 * Bước SAU KHI đăng từ Add Custom Listing: theo dõi kết quả thật của lượt chạy, rồi giữ cấu hình sang sản phẩm mới.
 * Hàm thuần — kiểm bằng `npm run test:custom-listing-next`.
 */

// ---------------------------------------------------------------------------
// Kết quả lượt chạy
// ---------------------------------------------------------------------------

export type ListingRunMode = 'LIST' | 'LIVE';
export type ListingRunOutcome = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

/** Phần `lastJob` của chi tiết lượt đăng mà phép quyết định cần đọc. */
export interface ListingRunJob {
  id: string;
  status: string;
  totalItems: number;
  successItems: number;
  failedItems: number;
  lastError: string | null;
}

/**
 * 🔴 `POST /start` và `/publish-live` chỉ ĐƯA VÀO HÀNG ĐỢI — trả 200 lúc chưa có gì lên sàn. Thành công chỉ được kết
 * luận từ trạng thái cuối của ĐÚNG job vừa tạo (backend chốt ở `finalize`: mọi item SUCCESS ⇒ `COMPLETED`).
 *
 * `lastJob` khác `jobId` nghĩa là dữ liệu đọc được còn của lượt trước ⇒ chưa biết gì, tuyệt đối không dùng kết quả cũ.
 * Job xong một phần (shop A được, shop B lỗi) KHÔNG phải thành công.
 */
export function listingRunOutcome(
  job: ListingRunJob | null | undefined,
  jobId: string | null | undefined,
): ListingRunOutcome {
  if (!job || !jobId || job.id !== jobId) return 'RUNNING';
  switch (job.status) {
    case 'COMPLETED':
      return job.successItems > 0 && job.failedItems === 0 ? 'SUCCESS' : 'PARTIAL';
    case 'COMPLETED_WITH_ERRORS':
      return 'PARTIAL';
    case 'FAILED':
    case 'CANCELLED':
      return 'FAILED';
    default:
      return 'RUNNING';
  }
}

interface ListingRunRef {
  sessionId: string;
  jobId: string;
  mode: ListingRunMode;
}

export type ListingRunState =
  | { phase: 'IDLE' }
  | ({ phase: 'RUNNING' } & ListingRunRef)
  | ({ phase: 'DONE' } & ListingRunRef)
  | ({
      phase: 'FAILED';
      outcome: 'PARTIAL' | 'FAILED';
      successItems: number;
      totalItems: number;
      lastError: string | null;
    } & ListingRunRef);

export type ListingRunEvent =
  | ({ type: 'STARTED' } & ListingRunRef)
  | { type: 'SETTLED'; jobId: string; outcome: Exclude<ListingRunOutcome, 'RUNNING'>; job: ListingRunJob | null }
  | { type: 'DISMISS' };

export const LISTING_RUN_IDLE: ListingRunState = { phase: 'IDLE' };

/**
 * 🔴 Một trạng thái duy nhất ⇒ KHÔNG THỂ có hai popup chồng nhau. Kết quả chỉ được nhận khi đang `RUNNING` đúng job
 * đó: callback chạy lặp, polling về muộn hay kết quả của job cũ đều bị bỏ; đóng popup rồi thì nó không tự mở lại.
 */
export function listingRunReducer(state: ListingRunState, event: ListingRunEvent): ListingRunState {
  switch (event.type) {
    case 'STARTED':
      if (state.phase === 'RUNNING') return state;
      return { phase: 'RUNNING', sessionId: event.sessionId, jobId: event.jobId, mode: event.mode };
    case 'SETTLED': {
      if (state.phase !== 'RUNNING' || state.jobId !== event.jobId) return state;
      const { sessionId, jobId, mode } = state;
      if (event.outcome === 'SUCCESS') return { phase: 'DONE', sessionId, jobId, mode };
      return {
        phase: 'FAILED',
        sessionId,
        jobId,
        mode,
        outcome: event.outcome,
        successItems: event.job?.successItems ?? 0,
        totalItems: event.job?.totalItems ?? 0,
        lastError: event.job?.lastError ?? null,
      };
    }
    case 'DISMISS':
      return state.phase === 'RUNNING' ? state : LISTING_RUN_IDLE;
  }
}

// ---------------------------------------------------------------------------
// Giữ cấu hình sang sản phẩm mới
// ---------------------------------------------------------------------------

/**
 * Form của sản phẩm MỚI, giữ cấu hình của sản phẩm vừa đăng.
 *
 * ```
 *   Giữ    Market · Shops · Group Template · Category & Attributes (kèm Brand + Kho — cùng khu vực trên form)
 *          · Mô tả · Package · SKU & Pricing: mẫu, trục, giá, tồn của từng tổ hợp
 *   Mới    Tiêu đề · Từ khoá · Highlights · Ảnh · Bảng size · Video · Image Template
 *          · Seller SKU, barcode, ảnh của từng biến thể
 * ```
 *
 * 🔴 Dựng từ form RỖNG rồi chép từng nhóm được phép — thêm trường mới vào form thì mặc định KHÔNG bị mang sang, thay vì
 * phải nhớ thêm nó vào danh sách xoá. Session id / kết quả đăng không nằm trong form nên không thể đi theo.
 *
 * 🔴 Seller SKU sinh lại từ mẫu đang chọn hoặc từ giá trị biến thể (như khi bấm "Tạo SKU" trên form mới), không chép
 * mã của sản phẩm cũ: mã gõ tay thường mang định danh của sản phẩm đó.
 */
export function carryOverCustomListingForm(
  form: CustomListingForm,
  options: SkuBuildOptions = {},
): CustomListingForm {
  return {
    ...emptyCustomListingForm(),
    market: form.market,
    shopIds: [...form.shopIds],
    category: { ...form.category },
    attributeValues: Object.fromEntries(
      Object.entries(form.attributeValues).map(([id, selection]) => [
        id,
        { valueIds: [...selection.valueIds], customValues: [...selection.customValues] },
      ]),
    ),
    brand: { ...form.brand },
    warehouseId: form.warehouseId,
    description: form.description,
    pkg: { ...form.pkg },
    variations: form.variations.map(({ name, values }) => ({ name, values: [...values] })),
    skus: form.skus.map((sku) => carryOverSku(sku, options)),
    templates: { ...form.templates, image: '' },
  };
}

function carryOverSku(sku: ManualSku, options: SkuBuildOptions): ManualSku {
  const optionValues = sku.optionValues.map((option) => ({ ...option }));
  const seeded = options.seed?.(optionValues);
  return {
    sellerSku: seeded?.sellerSku?.trim() || suggestSellerSku(optionValues, options),
    optionValues,
    salePrice: sku.salePrice ?? '',
    retailPrice: sku.retailPrice ?? '',
    // 🔴 `??`: tồn 0 là cấu hình hợp lệ, phải giữ đúng 0.
    quantity: sku.quantity ?? 0,
    ...(seeded?.barcode ? { barcode: seeded.barcode } : {}),
  };
}

/** Thứ đi kèm form sang màn hình mới. */
export interface CustomListingCarry {
  form: CustomListingForm;
  /** Bộ thuộc tính dự phòng cho lúc định nghĩa của danh mục chưa nạp xong (xem `AttributeSource.fallback`). */
  attributes: ManualAttribute[];
}

/**
 * Chuyển cấu hình qua một lần điều hướng — CHỈ trong bộ nhớ, không localStorage/sessionStorage: tải lại trang là mất,
 * đóng tab là mất, không có gì nằm lại trên máy.
 *
 * 🔴 Một ô duy nhất, khoá theo `token` VÀ chủ sở hữu (tổ chức + người dùng): đăng xuất rồi đăng nhập tài khoản khác
 * trong cùng tab không đọc được cấu hình (shop, giá) của người trước.
 */
let carrySlot: { token: string; ownerId: string; carry: CustomListingCarry } | null = null;
let carrySequence = 0;

export function stashCustomListingCarry(ownerId: string, carry: CustomListingCarry): string {
  carrySequence += 1;
  const token = `${Date.now().toString(36)}-${carrySequence}`;
  carrySlot = { token, ownerId, carry };
  return token;
}

export function peekCustomListingCarry(
  token: string | null | undefined,
  ownerId: string | null,
): CustomListingCarry | null {
  if (!token || !ownerId || !carrySlot) return null;
  return carrySlot.token === token && carrySlot.ownerId === ownerId ? carrySlot.carry : null;
}

export function clearCustomListingCarry(token: string | null | undefined): void {
  if (carrySlot && carrySlot.token === token) carrySlot = null;
}
