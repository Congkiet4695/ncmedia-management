import type {
  FulfillmentIssue,
  FulfillmentState,
  FulfillmentStatus,
  ProviderCatalogProduct,
  ProviderCatalogVariation,
} from './types';

/**
 * **Luật thuần của màn hình Cấu hình sản phẩm / Fulfill** — không React, không i18n.
 *
 * Ở đây vì ba lý do:
 *  1. Nhãn hiển thị và định danh là hai thứ tách rời — luật "cái gì được vẽ ra màn hình" phải
 *     nằm ở MỘT chỗ, không rải trong JSX của từng component.
 *  2. Điều kiện "lưu được" và "gửi được" phải là MỘT hàm, dùng chung cho nút, cho thông điệp
 *     và cho chốt chặn lúc submit — ba bản sao là ba hành vi khác nhau.
 *  3. Kiểm được bằng `npm run test:fulfill-config` mà không cần dựng DOM.
 */

// ---------------------------------------------------------------------------
// Nhãn hiển thị
// ---------------------------------------------------------------------------

/** Chuỗi có dạng UUID — định danh kỹ thuật, tuyệt đối không hiển thị. */
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * `sku` này có phải MÃ NGHIỆP VỤ không, hay chỉ là id kỹ thuật viết lại?
 *
 * 🔴 MangoTee trả `sku = "PROD-<id sản phẩm>"` cho toàn bộ danh mục. Backend đã lọc ở cả lượt
 * đồng bộ lẫn lúc đọc, nhưng giao diện vẫn kiểm lại: một bản ghi cũ, một nhà cung cấp mới hay
 * một lượt đồng bộ chưa chạy đều có thể đẩy chuỗi đó ra tới đây, và người dùng KHÔNG được
 * nhìn thấy UUID trong ô chọn — dù dữ liệu tới từ đâu.
 */
export function isBusinessSku(sku: string | null | undefined, externalId?: string | null): boolean {
  const value = sku?.trim();
  if (!value) return false;
  if (UUID_LIKE.test(value)) return false;
  const id = externalId?.trim().toLowerCase();
  if (id && value.toLowerCase().includes(id)) return false;
  return true;
}

/**
 * Nhãn của một sản phẩm nhà cung cấp trong ô chọn.
 *
 * `Tên sản phẩm` — kèm ` · SKU` khi nhà cung cấp có mã nghiệp vụ thật. Định danh (`id`,
 * `externalProductId`) KHÔNG bao giờ nằm trong nhãn; chúng đi trong `value` và trong payload.
 */
export function providerProductLabel(
  product: Pick<ProviderCatalogProduct, 'name' | 'sku' | 'externalProductId'>,
): string {
  const name = product.name?.trim() || '';
  return isBusinessSku(product.sku, product.externalProductId) && name
    ? `${name} · ${product.sku as string}`
    : name;
}

/** Nhãn của một biến thể: `SKU · tên biến thể` (SKU biến thể LÀ mã gửi sang xưởng in). */
export function providerVariantLabel(
  variant: Pick<ProviderCatalogVariation, 'sku' | 'name' | 'externalVariantId'>,
): string {
  const sku = isBusinessSku(variant.sku, variant.externalVariantId) ? variant.sku : '';
  const name = variant.name?.trim() || '';
  return [sku, name].filter(Boolean).join(' · ') || name || sku;
}

// ---------------------------------------------------------------------------
// Danh sách option có phân trang
// ---------------------------------------------------------------------------

export interface ProductOption {
  value: string;
  label: string;
}

/**
 * Gộp các trang đã tải thành danh sách option, **lựa chọn hiện tại luôn có mặt**.
 *
 * 🔴 Đây là chỗ sửa lỗi "mở lại thì ô chọn trống": sản phẩm đã lưu thường nằm ở trang 8 của
 * danh mục, nên nó KHÔNG có trong trang đầu. Nếu option của nó không được ghép vào đây thì ô
 * chọn không tra được nhãn và rơi về placeholder — người dùng tưởng chưa chọn gì rồi lưu đè
 * bằng rỗng. Ghép vào đầu danh sách và khử trùng theo `id`.
 */
export function mergeProductOptions(
  selected: ProviderCatalogProduct | null,
  pages: ProviderCatalogProduct[],
): ProductOption[] {
  const seen = new Set<string>();
  const options: ProductOption[] = [];
  for (const product of [...(selected ? [selected] : []), ...pages]) {
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);
    options.push({ value: product.id, label: providerProductLabel(product) });
  }
  return options;
}

// ---------------------------------------------------------------------------
// "Lưu được chưa" — cấu hình của MỘT dòng hàng
// ---------------------------------------------------------------------------

export type ConfigBlocker =
  /** Kết nối TikTok của đơn chưa gán nhà cung cấp fulfillment. */
  | 'NO_PROVIDER'
  /** Dòng hàng thiếu Product ID hoặc Seller SKU ⇒ không có khoá để lưu ánh xạ. */
  | 'MISSING_PRODUCT_KEY'
  /** Chưa chọn sản phẩm của nhà cung cấp. */
  | 'NO_PRODUCT'
  /** Sản phẩm đã lưu không còn trong danh mục đã đồng bộ. */
  | 'PRODUCT_UNAVAILABLE'
  /** Chưa chốt được biến thể (SKU, hoặc cặp Color + Size). */
  | 'NO_VARIANT';

export interface ConfigDraft {
  accountId: string | null;
  tiktokProductId: string | null;
  sellerSku: string | null;
  providerProductId: string;
  productUnavailable?: boolean;
  variant: Pick<ProviderCatalogVariation, 'sku' | 'externalVariantId'> | null;
}

/**
 * Những gì còn THIẾU để lưu được cấu hình — theo đúng hợp đồng của
 * `POST/PATCH /fulfillment/mappings` (`accountId`, `tiktokProductId`, `sellerSku`,
 * `providerSku`, `providerProductId`, `providerVariantId`).
 *
 * 🔴 KHÔNG tự thêm điều kiện mà API không đòi: production line, production config và giá vốn
 * đều là tuỳ chọn ở backend, nên chúng cũng không được chặn nút Lưu ở đây.
 */
export function configBlockers(draft: ConfigDraft): ConfigBlocker[] {
  const blockers: ConfigBlocker[] = [];
  if (!draft.accountId) blockers.push('NO_PROVIDER');
  if (!draft.tiktokProductId || !draft.sellerSku) blockers.push('MISSING_PRODUCT_KEY');
  if (!draft.providerProductId) blockers.push('NO_PRODUCT');
  else if (draft.productUnavailable) blockers.push('PRODUCT_UNAVAILABLE');
  if (!draft.variant) blockers.push('NO_VARIANT');
  return blockers;
}

/** Cấu hình đã đủ để lưu chưa — cùng một nguồn với `configBlockers`. */
export function isFulfillmentConfigValid(draft: ConfigDraft): boolean {
  return configBlockers(draft).length === 0;
}

// ---------------------------------------------------------------------------
// "Gửi được chưa" — cả đơn
// ---------------------------------------------------------------------------

/** Trạng thái còn cho phép gửi (hoặc gửi lại) — CÙNG tập với `FULFILLABLE_STATUSES` ở backend. */
export const SUBMITTABLE_STATUSES: readonly FulfillmentStatus[] = ['DRAFT', 'FAILED'];

export type SubmitBlocker =
  /** Chưa đọc được trạng thái (đang tải hoặc lỗi mạng). */
  | { code: 'LOADING' }
  /** Đơn đã gửi rồi / đã huỷ ⇒ không còn nút gửi. */
  | { code: 'STATUS'; status: FulfillmentStatus }
  /** Đang có một lượt gửi chạy. */
  | { code: 'BUSY' }
  /** Backend liệt kê lý do cụ thể (thiếu ánh xạ, thiếu design, địa chỉ bị che…). */
  | { code: 'NOT_READY'; issues: FulfillmentIssue[] };

/**
 * Vì sao nút **Đẩy sang Fulfill** đang tắt — NGUỒN DUY NHẤT cho cả ba nơi: trạng thái
 * `disabled` của nút, thông điệp giải thích ngay cạnh nút, và chốt chặn trong `submit()`.
 *
 * 🔴 Danh sách rỗng ⇔ được phép gửi. Không nơi nào được tự cộng thêm điều kiện: điều kiện
 * thật nằm ở backend (`state.canFulfill`, `state.issues`) và đây chỉ là cách đọc lại chúng —
 * nhờ vậy không thể có chuyện nút sáng mà API từ chối, hay nút tắt mà không ai biết vì sao.
 */
export function submitBlockers(params: {
  state: FulfillmentState | null | undefined;
  status: FulfillmentStatus;
  submitting?: boolean;
}): SubmitBlocker[] {
  const { state, status } = params;
  if (!state) return [{ code: 'LOADING' }];

  const blockers: SubmitBlocker[] = [];
  if (params.submitting) blockers.push({ code: 'BUSY' });
  if (!SUBMITTABLE_STATUSES.includes(status)) blockers.push({ code: 'STATUS', status });
  if (!state.canFulfill && SUBMITTABLE_STATUSES.includes(status)) {
    blockers.push({ code: 'NOT_READY', issues: state.issues ?? [] });
  }
  return blockers;
}

/** Được phép bấm gửi hay không — đọc lại `submitBlockers`, không tính lại điều kiện. */
export function canSubmitFulfillment(params: {
  state: FulfillmentState | null | undefined;
  status: FulfillmentStatus;
  submitting?: boolean;
}): boolean {
  return submitBlockers(params).length === 0;
}
