import type { PodProductListImage } from './types';

/**
 * Chuẩn bị bộ ảnh của MỘT sản phẩm cho dải thumbnail và bộ xem ảnh.
 *
 * 🔴 Vì sao tách thành hàm thuần, không viết thẳng trong component: đây là chỗ quyết định
 * **thumbnail nào mở ra ảnh nào**. Lọc ảnh hỏng và loại trùng làm danh sách NGẮN LẠI, nên
 * nếu component render thumbnail từ mảng gốc mà mở lightbox theo mảng đã lọc thì bấm ảnh
 * thứ 3 sẽ mở ảnh thứ 4 — một lỗi lệch chỉ số không ai thấy được bằng mắt cho tới khi so
 * từng tấm. Dựng MỘT mảng dùng cho cả hai việc là cách duy nhất khiến lỗi đó không tồn tại.
 */

/** Một ảnh đã sẵn sàng hiển thị: bản nhỏ cho bảng, bản gốc cho bộ xem. */
export interface ProductGalleryImage {
  /**
   * URL **ẢNH GỐC** — thứ lightbox mở.
   *
   * 🔴 TikTok trả về hai biến thể của cùng một tấm ảnh: `url` là bản gốc
   * (`…-origin-jpeg.jpeg`), `thumbUrl` là bản đã thu nhỏ cứng 300×300
   * (`…-resize-jpeg:300:300.jpeg`). Mở lightbox bằng `thumbUrl` nghĩa là phóng to một tấm
   * 300px lên gần hết màn hình — vỡ nhoè, và người dùng tưởng ảnh sản phẩm của họ chất
   * lượng kém. Cả hai URL đều đã có sẵn trong response, không phải gọi thêm gì.
   */
  src: string;
  /** URL bản thu nhỏ — thứ bảng render. Lùi về `src` khi không có bản nhỏ. */
  thumb: string;
}

/** Chuỗi có dùng được làm URL ảnh không (bỏ chuỗi rỗng / chỉ khoảng trắng). */
function usableUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Lọc ảnh hỏng, loại trùng, và chọn đúng biến thể URL cho từng mục đích.
 *
 * Thứ tự các ảnh còn lại giữ NGUYÊN như server trả về (`sortOrder`) — ảnh chính luôn đứng đầu.
 *
 * - Thiếu cả hai URL ⇒ bỏ hẳn, không render một thẻ `img` chắc chắn hỏng.
 * - Chỉ có một trong hai URL ⇒ dùng chính nó cho cả hai vai.
 * - Trùng `src` ⇒ giữ tấm ĐẦU TIÊN. Bộ xem lặp lại cùng một tấm hai lần chỉ làm người dùng
 *   tưởng nút "ảnh sau" bị kẹt.
 */
export function buildProductGallery(
  images: readonly PodProductListImage[] | null | undefined,
): ProductGalleryImage[] {
  const gallery: ProductGalleryImage[] = [];
  const seen = new Set<string>();

  for (const image of images ?? []) {
    const original = usableUrl(image.url);
    const thumbnail = usableUrl(image.thumbUrl);
    const src = original ?? thumbnail;
    if (!src || seen.has(src)) continue;

    seen.add(src);
    gallery.push({ src, thumb: thumbnail ?? src });
  }

  return gallery;
}

/**
 * Số ảnh KHÔNG xuất hiện trên dải thumbnail — nguồn của chỉ báo `+N`.
 *
 * Gồm hai phần: ảnh server chưa gửi về (danh sách đã bị cắt ở
 * `POD_PRODUCT_LIST_IMAGE_TAKE`) và ảnh đã nhận nhưng dải chỗ không đủ để bày ra.
 *
 * 🔴 Trừ đi phần đã bị loại (trùng / hỏng): `imageCount` là số dòng ảnh phía DB, còn dải
 * thumbnail hiển thị bộ đã lọc. Không trừ thì một sản phẩm có hai ảnh trùng nhau sẽ hiện
 * "+1" trỏ tới một tấm không tồn tại.
 */
export function countHiddenImages(params: {
  /** `imageCount` — tổng số ảnh chính phía server. */
  totalOnServer: number;
  /** Số ảnh server thực sự gửi về trong danh sách. */
  received: number;
  /** Số ảnh còn lại sau khi lọc hỏng + loại trùng. */
  usable: number;
  /** Số thumbnail thực sự được render. */
  shown: number;
}): number {
  const removed = Math.max(0, params.received - params.usable);
  return Math.max(0, params.totalOnServer - removed - params.shown);
}
