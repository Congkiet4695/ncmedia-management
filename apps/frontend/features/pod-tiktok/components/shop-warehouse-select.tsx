'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useApiError } from '@/hooks/use-api-error';
import { useWarehouses } from '@/features/pod-listing/hooks/use-pod-listing';
import { useSetShopWarehouse } from '../hooks/use-pod-tiktok';

/**
 * **Shop Settings → kho mặc định của shop** (Warehouse Mapping).
 *
 * 🔴 Kho là dữ liệu CỦA SHOP, không phải của sản phẩm. Cùng một Draft Product đăng lên ba
 * shop là ba kho khác nhau, nên Draft không gắn kho và màn hình Draft cũng không hỏi kho —
 * kho chỉ được quyết ở bước Publish, và đây là chỗ khai báo lựa chọn của từng shop.
 *
 * Để trống là hợp lệ: lúc Publish hệ thống tự suy (kho của Category Template nếu thuộc chính
 * shop này → shop chỉ có một kho → kho TikTok đánh dấu mặc định).
 */
export function ShopWarehouseSelect({
  accountId,
  shopId,
  shopName,
  currentWarehouseId,
  currentWarehouseName,
}: {
  accountId: string;
  shopId: string;
  shopName: string;
  currentWarehouseId: string | null;
  currentWarehouseName: string | null;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const mutation = useSetShopWarehouse();
  const [saved, setSaved] = useState(false);

  // Chỉ kho CỦA CHÍNH SHOP NÀY: `warehouse_id` là mã riêng của từng shop, gán kho của shop
  // khác thì TikTok từ chối cả sản phẩm.
  const warehouses = useWarehouses({ shopId });

  const options: ComboboxOption[] = [
    { value: '', label: t('account.warehouseAuto') },
    ...(warehouses.data ?? []).map((warehouse) => ({
      value: warehouse.id,
      label: warehouse.name ?? warehouse.tiktokWarehouseId,
      hint: warehouse.isDefault ? t('account.warehouseTiktokDefault') : undefined,
    })),
  ];
  // Kho đang gán mà chưa có trong cache (chưa đồng bộ lại) vẫn phải hiện ra.
  if (currentWarehouseId && !options.some((option) => option.value === currentWarehouseId)) {
    options.splice(1, 0, {
      value: currentWarehouseId,
      label: currentWarehouseName ?? currentWarehouseId,
    });
  }

  const handleChange = async (value: string): Promise<void> => {
    try {
      await mutation.mutateAsync({ accountId, shopId, warehouseId: value || null });
      setSaved(true);
      toast.success(t('account.warehouseSaved', { shop: shopName }));
    } catch (error) {
      toast.error(translateApiError(error));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Combobox
        value={currentWarehouseId ?? ''}
        onChange={(value) => void handleChange(value)}
        options={options}
        loading={warehouses.isFetching}
        disabled={mutation.isPending}
        className="h-9 min-w-[190px] max-w-[260px] text-sm"
        placeholder={t('account.warehouseAuto')}
      />
      {mutation.isPending ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        saved && <Check className="size-4 shrink-0 text-emerald-600" />
      )}
    </div>
  );
}
