/**
 * Ảnh hiển thị của MỘT dòng đơn — luật dùng chung cho danh sách Order và Product Configuration (Fulfill).
 *
 * Thứ tự ưu tiên:
 *  1. `skuImage` — `line_items[].sku_image` của TikTok: ảnh của ĐÚNG biến thể khách đã đặt (màu/size).
 *  2. `productImage` — ảnh chính của sản phẩm (backend ghép từ danh mục Products đã đồng bộ).
 *  3. Hết ứng viên ⇒ mỗi màn hình giữ placeholder hiện có của nó.
 *
 * Trả về DANH SÁCH ứng viên chứ không phải một URL: link ảnh TikTok có hạn dùng, ảnh biến thể tải lỗi thì
 * `ItemThumbnail` chuyển sang ứng viên kế tiếp thay vì để lại ảnh vỡ.
 */

export interface ItemImageSource {
  skuImage: string | null;
  productImage: string | null;
  productImageFull?: string | null;
}

/** URL dùng được cho `<img>`: khác rỗng sau khi cắt khoảng trắng và là http(s) tuyệt đối. */
export function isUsableImageUrl(value: string | null | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function candidates(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (!isUsableImageUrl(value)) continue;
    const url = value.trim();
    if (!result.includes(url)) result.push(url);
  }
  return result;
}

/** Ứng viên cho thumbnail, theo thứ tự ưu tiên. Rỗng ⇒ hiện placeholder. */
export function itemThumbnailCandidates(item: ItemImageSource): string[] {
  return candidates([item.skuImage, item.productImage]);
}

/** Ứng viên cho bộ xem ảnh cỡ lớn: ảnh biến thể, rồi ảnh sản phẩm cỡ đầy đủ, rồi thumbnail sản phẩm. */
export function itemFullImageCandidates(item: ItemImageSource): string[] {
  return candidates([item.skuImage, item.productImageFull, item.productImage]);
}
