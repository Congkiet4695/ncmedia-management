'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { usePodProductFilters } from '@/features/pod-product/hooks/use-pod-products';

/**
 * Shop chọn được ở Listing (Listing CSV và Add Custom Listing): CHỈ shop đang hoạt động.
 *
 * Lọc ở backend (`GET /pod/products/filters?activeShopsOnly=true`), không ẩn ở đây — các màn
 * hình khác dùng chung endpoint (Products, Flash Sale, Clone) vẫn nhận đủ shop như cũ. Backend
 * còn kiểm lại khi tạo / sửa lượt đăng (`POD_SESSION_SHOP_INACTIVE`).
 *
 * Lượt đăng đã lưu có thể giữ một shop bị ngưng SAU khi chọn. Shop đó không còn trong danh sách
 * ⇒ bỏ khỏi lựa chọn (và báo cho người dùng) thay vì giữ lại để lần lưu sau bị từ chối.
 * `pruneSelection: false` cho màn hình chỉ đọc — không sửa lựa chọn người dùng không lưu được.
 */
export function useListingShops(
  selectedIds: string[],
  onPrune: (keptIds: string[]) => void,
  pruneSelection = true,
) {
  const { t } = useTranslation('pod');
  const query = usePodProductFilters({ activeShopsOnly: true });
  const shops = query.data?.shops;

  // Hàm của nơi gọi đổi mỗi lần render — giữ bản mới nhất trong ref để effect không chạy lại vô cớ.
  const onPruneRef = useRef(onPrune);
  onPruneRef.current = onPrune;

  useEffect(() => {
    if (!shops || !pruneSelection || selectedIds.length === 0) return;
    const active = new Set(shops.map((shop) => shop.id));
    const kept = selectedIds.filter((id) => active.has(id));
    if (kept.length === selectedIds.length) return;
    onPruneRef.current(kept);
    toast.warning(
      t('listing.sessions.inactiveShopsRemoved', { count: selectedIds.length - kept.length }),
    );
  }, [shops, selectedIds, pruneSelection, t]);

  return {
    shops: shops ?? [],
    isLoading: query.isLoading,
    /** Đã tải xong mà không có shop nào đăng được ⇒ hiện thông báo, khoá ô chọn. */
    noActiveShop: Boolean(shops) && shops?.length === 0,
  };
}
