import type {
  PodDesign,
  PodItemMappingStatus,
  PodMappingCandidate,
  PodOrderItem,
  PodOrderListItem,
} from './order-types';

/**
 * View-model của màn hình POD Orders — **thuần trình bày**.
 *
 * 🔴 Không gọi API, không đổi DTO. Mọi thứ ở đây được suy ra từ dữ liệu mà
 * `GET /pod/tiktok/orders` ĐANG trả về. Tách khỏi component để những phép suy luận dễ sai
 * (gộp SKU, cộng tiền, gom tracking) có một chỗ duy nhất để đọc và sửa.
 */

/** Ký tự cho giá trị rỗng — thống nhất với `use-locale-format`. */
export const EMPTY = '—';

/**
 * Định dạng ngày giờ `YYYY-MM-DD HH:mm` theo yêu cầu §1.
 *
 * 🔴 KHÔNG dùng `useLocaleFormat().formatDateTime`: hàm đó đổi thứ tự ngày/tháng theo ngôn
 * ngữ (dd/MM ở vi, MM/dd ở en). Nhân viên fulfillment đọc hàng trăm đơn mỗi ngày và đối
 * chiếu với Seller Center — một định dạng cố định, sắp xếp được, không mơ hồ là thứ họ cần.
 */
export function formatOrderDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;

  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Tiền tệ của đơn POD.
 *
 * 🔴 Mặc định **USD** khi TikTok không trả `currency` (yêu cầu §3: "Format toàn bộ USD,
 * không dùng VND"). Để trống thì `Intl` rơi về ngôn ngữ đang chọn và một đơn 20 USD hiện
 * thành "20 ₫" — sai lệch 25.000 lần, đủ để ai đó ra quyết định sai.
 */
export const DEFAULT_ORDER_CURRENCY = 'USD';

export function orderCurrency(currency: string | null | undefined): string {
  return currency ?? DEFAULT_ORDER_CURRENCY;
}

// ---------------------------------------------------------------------------
// Sản phẩm
// ---------------------------------------------------------------------------

/**
 * Một dòng sản phẩm sau khi GỘP các line item giống nhau.
 *
 * 🔴 TikTok trả **1 line item = 1 đơn vị**, nên một đơn mua 2 tấm poster giống hệt về dưới
 * dạng hai bản ghi. Hiển thị hai dòng y hệt nhau là bắt người đóng gói tự đếm; §2 yêu cầu
 * "SKU × Quantity" nên gộp là đúng.
 *
 * `sources` giữ lại TỪNG line item gốc để nút Upload có một item cụ thể để mở dialog.
 */
export interface OrderProductRow {
  key: string;
  productId: string | null;
  productName: string | null;
  skuImage: string | null;
  sellerSku: string | null;
  skuName: string | null;
  productCategory: string | null;
  isPodCustomized: boolean;
  quantity: number;
  /** Các line item gốc tạo nên dòng này (theo đúng thứ tự API trả về). */
  sources: PodOrderItem[];
  /** Product Mapping của SKU này — `null` = CHƯA khai ánh xạ, không thể upload design. */
  mappingId: string | null;
  /** Vì sao chưa ánh xạ (hoặc đã ánh xạ) — quyết định hiện nút gì. */
  mappingStatus: PodItemMappingStatus;
  /** Ứng viên máy gợi ý, chỉ có khi `NEED_MANUAL`. */
  mappingCandidates: PodMappingCandidate[];
  /**
   * Design của SKU này.
   *
   * 🔴 Design thuộc **Product Mapping**, không thuộc line item: mọi đơn vị cùng SKU dùng
   * CHUNG một bộ file in. Vì thế đây là một danh sách của cả dòng, không phải "đếm bao nhiêu
   * đơn vị đã có design" như trước — cách đếm cũ sinh ra trạng thái "1/2 đã upload" không thể
   * tồn tại, và bắt người dùng upload lại đúng file đó cho từng đơn vị.
   */
  designs: PodDesign[];
}

/**
 * Gộp line item theo (productId, sellerSku/skuId, ảnh).
 *
 * Cố ý KHÔNG gộp theo mỗi `productId`: cùng một sản phẩm với hai biến thể (24x36 và 18x24)
 * là hai việc phải in khác nhau, gộp lại là mất thông tin cần để đóng gói.
 */
export function groupOrderProducts(items: PodOrderItem[]): OrderProductRow[] {
  const rows = new Map<string, OrderProductRow>();

  for (const item of items) {
    const key = [
      item.productId ?? '',
      item.sellerSku ?? item.skuId ?? '',
      item.skuImage ?? '',
    ].join('|');

    const existing = rows.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.sources.push(item);
      // Design/mapping giống nhau ở mọi đơn vị cùng SKU — chỉ bù khi line item đầu thiếu.
      if (existing.mappingId === null) {
        existing.mappingId = item.mappingId;
        existing.mappingStatus = item.mappingStatus;
        existing.mappingCandidates = item.mappingCandidates;
      }
      if (existing.designs.length === 0) existing.designs = item.designs;
      continue;
    }

    rows.set(key, {
      key,
      productId: item.productId,
      productName: item.productName,
      skuImage: item.skuImage,
      sellerSku: item.sellerSku ?? item.skuId,
      skuName: item.skuName,
      productCategory: item.productCategory,
      isPodCustomized: item.isPodCustomized,
      quantity: item.quantity,
      sources: [item],
      mappingId: item.mappingId,
      mappingStatus: item.mappingStatus,
      mappingCandidates: item.mappingCandidates,
      designs: item.designs,
    });
  }

  return [...rows.values()];
}

/**
 * Line item đại diện để mở dialog upload design.
 *
 * 🔴 KHÔNG còn ưu tiên item đã ghép ánh xạ. Design lưu theo (Product ID + Seller SKU) và
 * không đòi hỏi ánh xạ, mà mọi item trong một nhóm đều cùng cặp khoá đó — nên item nào cũng
 * mở đúng cùng một bộ design.
 */
export function firstUndesignedSource(row: OrderProductRow): PodOrderItem {
  return row.sources[0];
}

/**
 * Trạng thái DESIGN của một dòng sản phẩm.
 *
 * ```
 *   MISSING_FRONT  chưa có mặt trước   (sửa bằng nút Upload Design)
 *   READY          đã có mặt trước
 * ```
 *
 * 🔴 KHÔNG có trạng thái "chưa ánh xạ" ở đây nữa. Ánh xạ là một trục HOÀN TOÀN KHÁC và được
 * hiển thị song song bằng `row.mappingStatus` — xem `MappingAction`. Trộn hai trục vào một
 * chính là ràng buộc "phải ánh xạ xong mới upload được design" mà sprint này gỡ bỏ.
 *
 * 🔴 **Front là mức tối thiểu, Back là tuỳ chọn.** Yêu cầu §5 nói rõ "Nếu Product chỉ cần
 * Front => Ready. Không bắt buộc mọi Product đều có Back Design" — nên thiếu Back KHÔNG phải
 * lỗi, chỉ là ghi chú (`backMissing`) hiển thị mờ bên cạnh. Đây cũng đúng bằng luật của
 * backend (`FulfillmentReadinessService`): có ít nhất một file in là gửi được.
 *
 */
export type RowDesignState = 'MISSING_FRONT' | 'READY';

export interface RowDesignStatus {
  state: RowDesignState;
  front: PodDesign | null;
  back: PodDesign | null;
  /** Đã sẵn sàng nhưng chưa có mặt sau — chỉ để hiển thị, KHÔNG chặn fulfill. */
  backMissing: boolean;
}

/**
 * Các sản phẩm CÒN THIẾU design mặt trước, mỗi Product Mapping đúng MỘT lần.
 *
 * 🔴 Khử trùng lặp theo `mappingId`, không theo line item: 10 đơn cùng một SKU chỉ cần
 * upload MỘT lần. Đếm theo line item sẽ báo "10 sản phẩm chưa có design" rồi sau lần upload
 * đầu tiên tụt thẳng về 0 — một con số vô nghĩa với người dùng.
 *
 * 🔴 Bỏ qua item chưa khai ánh xạ (`mappingId === null`): không có nơi lưu file, đưa vào hàng
 * đợi upload chỉ dẫn người dùng tới một dialog không làm gì được. Việc đó thuộc màn hình
 * Product Mapping.
 */
export function pendingDesignTargets(items: PodOrderItem[]): PodOrderItem[] {
  const seen = new Set<string>();
  const pending: PodOrderItem[] = [];

  for (const item of items) {
    if (item.mappingId === null || seen.has(item.mappingId)) continue;
    if (item.designs.some((design) => design.placement === 'FRONT')) continue;
    seen.add(item.mappingId);
    pending.push(item);
  }

  return pending;
}

export function rowDesignStatus(row: OrderProductRow): RowDesignStatus {
  const front = row.designs.find((design) => design.placement === 'FRONT') ?? null;
  const back = row.designs.find((design) => design.placement === 'BACK') ?? null;

  // 🔴 KHÔNG xét `mappingId`: trạng thái design nói về FILE IN, ánh xạ nói về NƠI SẢN XUẤT.
  // Trộn hai thứ lại chính là ràng buộc "phải ánh xạ xong mới upload được" mà sprint này gỡ.
  const state: RowDesignState = front ? 'READY' : 'MISSING_FRONT';

  return { state, front, back, backMissing: state === 'READY' && back === null };
}

// ---------------------------------------------------------------------------
// Giá
// ---------------------------------------------------------------------------

/**
 * Bốn dòng của cột Price (§3).
 *
 * 🔴 Chỉ `subtotal` và `buyerPaid` có dữ liệu thật từ endpoint danh sách:
 *   - `subtotal`   — CỘNG từ `items[].salePrice`, dữ liệu API đang trả về.
 *   - `buyerPaid`  — `totalAmount`.
 *   - `tax`        — chỉ có ở endpoint CHI TIẾT (`GET /orders/:id`), nên `null` ở dòng thu
 *                    gọn và được điền khi mở rộng dòng.
 *   - `estimated`  — **KHÔNG tồn tại trong hệ thống**. Không suy ra bằng công thức tự chế:
 *                    một con số tiền bịa ra trông y như số thật là thứ nguy hiểm nhất có thể
 *                    đặt lên màn hình vận hành.
 *
 * Xem mục "Khoảng trống dữ liệu" trong báo cáo để biết đúng thay đổi DTO cần có.
 */
export interface OrderPriceBreakdown {
  subtotal: number | null;
  tax: number | null;
  buyerPaid: number | null;
  estimated: number | null;
  currency: string;
}

export function buildPriceBreakdown(
  order: PodOrderListItem,
  /** Số liệu chính xác từ endpoint chi tiết, chỉ có sau khi mở rộng dòng. */
  detail?: { subTotal: number | null; tax: number | null; totalAmount: number | null } | null,
): OrderPriceBreakdown {
  const summed = order.items.reduce<number | null>((total, item) => {
    if (item.salePrice === null) return total;
    return (total ?? 0) + item.salePrice * item.quantity;
  }, null);

  return {
    subtotal: detail?.subTotal ?? summed,
    tax: detail?.tax ?? null,
    buyerPaid: detail?.totalAmount ?? order.totalAmount,
    estimated: null,
    currency: orderCurrency(order.currency),
  };
}

// ---------------------------------------------------------------------------
// Vận đơn
// ---------------------------------------------------------------------------

/**
 * Gom mã vận đơn của đơn: cấp ĐƠN cộng cấp SẢN PHẨM, bỏ trùng, giữ thứ tự xuất hiện.
 *
 * Đơn nhiều kiện thì TikTok gắn tracking lên từng line item và `order.trackingNumber` chỉ là
 * một trong số đó — chỉ hiển thị cột đơn là giấu mất phần còn lại (§5 yêu cầu dạng danh sách).
 */
export function collectTrackingNumbers(order: PodOrderListItem): string[] {
  const seen = new Set<string>();
  const push = (value: string | null): void => {
    const trimmed = value?.trim();
    if (trimmed) seen.add(trimmed);
  };

  push(order.trackingNumber);
  for (const item of order.items) push(item.trackingNumber);

  return [...seen];
}

// ---------------------------------------------------------------------------
// Xuất file
// ---------------------------------------------------------------------------

/** Một ô CSV — bọc nháy kép và nhân đôi nháy bên trong (RFC 4180). */
function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Xuất các đơn ĐANG CHỌN ra CSV — **hoàn toàn phía trình duyệt**.
 *
 * 🔴 Hệ thống không có endpoint export cho đơn POD, và sprint này cấm đổi API. Dựng file từ
 * chính dữ liệu đã tải về là cách duy nhất giữ được tính năng mà không chạm backend — đổi
 * lại, nó chỉ xuất được những đơn đang hiển thị, không phải toàn bộ kết quả lọc.
 */
export function buildOrdersCsv(orders: PodOrderListItem[], headers: string[]): string {
  const rows = orders.map((order) => {
    const price = buildPriceBreakdown(order);
    return [
      order.tiktokOrderId,
      formatOrderDateTime(order.createdTime),
      order.shopName,
      order.sellerEmail,
      order.status,
      order.itemCount,
      price.subtotal,
      price.buyerPaid,
      price.currency,
      collectTrackingNumbers(order).join(' | '),
      order.items.map((item) => `${item.sellerSku ?? item.skuId ?? ''}`).join(' | '),
    ]
      .map(csvCell)
      .join(',');
  });

  // BOM để Excel trên Windows đọc đúng tiếng Việt có dấu.
  return `﻿${headers.map(csvCell).join(',')}\n${rows.join('\n')}`;
}

/** Tải một chuỗi về máy dưới dạng file. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Ảnh cho lightbox
//
// 🔴 Ảnh SẢN PHẨM và ảnh DESIGN dùng CHUNG một bộ xem (`ImageLightbox`). Hai hàm dưới đây chỉ
// dựng danh sách; toàn bộ hành vi xem (phóng to, đi tới/lui, tải về) nằm ở component đó, nên
// hai loại ảnh không thể có trải nghiệm lệch nhau.
// ---------------------------------------------------------------------------

/** Một ảnh đưa vào lightbox. Trùng `LightboxImage` của component (khai lại để tránh vòng import). */
export interface OrderLightboxImage {
  src: string;
  label?: string;
  fileName?: string;
}

/** Yêu cầu mở lightbox: xem bộ ảnh nào, bắt đầu từ ảnh thứ mấy. */
export interface LightboxRequest {
  images: OrderLightboxImage[];
  index: number;
}

/**
 * Ảnh của MỌI sản phẩm trong một đơn.
 *
 * Mở từ một sản phẩm nhưng đưa cả bộ vào, để người dùng lướt qua toàn bộ hàng trong đơn mà
 * không phải đóng/mở lightbox từng lần — đơn nhiều sản phẩm là chuyện thường.
 */
export function orderProductImages(rows: OrderProductRow[]): OrderLightboxImage[] {
  return rows
    .filter((row) => Boolean(row.skuImage))
    .map((row) => ({
      src: row.skuImage as string,
      label: row.productName ?? row.sellerSku ?? undefined,
    }));
}

/** Ảnh design (Front/Back) của MỘT dòng sản phẩm, theo đúng thứ tự đang hiển thị. */
export function rowDesignImages(row: OrderProductRow): OrderLightboxImage[] {
  return row.designs.map((design) => ({
    src: design.fileUrl,
    label: design.placement,
    fileName: design.fileName,
  }));
}
