/**
 * Luật hiển thị Base Cost sau khi lưu ánh xạ — thuần, không React ⇒ kiểm được bằng
 * `npm run test:fulfill-config`.
 */

import type { ProductMapping } from './types';

/**
 * Lưu ánh xạ thành công nhưng Base Cost KHÔNG được cập nhật theo giá nhà cung cấp ⇒ khoá i18n
 * (namespace `fulfillment`) + lý do backend nêu. `null` khi giá đã được cập nhật (hoặc phản hồi
 * cũ không có trạng thái).
 */
export function baseCostSaveWarning(
  saved: Pick<ProductMapping, 'baseCostStatus' | 'baseCostMessage'> | null | undefined,
): { key: string; message: string | null } | null {
  switch (saved?.baseCostStatus) {
    case 'UNCHANGED':
      return { key: 'fulfill.config.baseCostUnchanged', message: saved.baseCostMessage ?? null };
    case 'PRICE_NOT_FOUND':
      return { key: 'fulfill.config.baseCostNotFound', message: saved.baseCostMessage ?? null };
    default:
      return null;
  }
}
