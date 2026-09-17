'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ShopOption {
  id: string;
  /** Tên gian hàng TikTok trả về. */
  name: string;
  /** Tên KẾT NỐI do người vận hành đặt — thứ họ thực sự nhớ (xem `shop-identity.ts`). */
  connectionName: string;
  /** Thị trường của shop. Không phải nguồn nào cũng có — hiện thì hiện, thiếu thì thôi. */
  region?: string;
}

/**
 * Chọn NHIỀU shop đích cho một lượt Custom Listing.
 *
 * 🔴 Danh sách đến từ API và CHỈ gồm shop người dùng được phép thấy: Employee nhận đúng
 * những shop Admin đã gán (`PodAccessScopeService`). Đây là tiện lợi, KHÔNG phải hàng rào —
 * backend kiểm lại lần nữa lúc tạo lượt đăng và trả 403 nếu có shop ngoài phạm vi.
 *
 * 🔴 Không dùng `<select multiple>`: chọn 8 shop bằng Ctrl+click là thao tác không ai làm
 * đúng lần đầu. Ở đây là danh sách tick, có tìm kiếm, có "chọn tất cả kết quả đang lọc", và
 * shop đã chọn hiện thành thẻ gỡ được.
 */
export function ShopMultiSelect({
  options,
  value,
  onChange,
  loading,
}: {
  options: ShopOption[];
  value: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation('pod');
  const [keyword, setKeyword] = useState('');

  const selected = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((shop) =>
      [shop.name, shop.connectionName, shop.region].some((field) =>
        field?.toLowerCase().includes(needle),
      ),
    );
  }, [options, keyword]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    onChange([...next]);
  };

  // "Chọn tất cả" chỉ tác động lên KẾT QUẢ ĐANG LỌC — bấm khi đang lọc "US" mà chọn luôn cả
  // shop EU là đúng thứ người dùng không lường được.
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((shop) => selected.has(shop.id));
  const toggleAllFiltered = () => {
    const next = new Set(selected);
    for (const shop of filtered) {
      if (allFilteredSelected) next.delete(shop.id);
      else next.add(shop.id);
    }
    onChange([...next]);
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const shop = options.find((item) => item.id === id);
            return (
              <Badge key={id} variant="muted" className="gap-1">
                {shop ? `${shop.connectionName} · ${shop.name}` : id}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={t('listing.custom.removeShop')}
                  className="rounded-full hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <div className="rounded-md border">
        <div className="relative border-b">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('listing.custom.searchShop')}
            className="border-0 pl-9 focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[220px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('listing.custom.loadingShops')}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {options.length === 0
                ? t('listing.custom.noShopPermitted')
                : t('listing.custom.noShopMatch')}
            </p>
          ) : (
            filtered.map((shop) => (
              <button
                key={shop.id}
                type="button"
                onClick={() => toggle(shop.id)}
                aria-pressed={selected.has(shop.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                  selected.has(shop.id) && 'bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    selected.has(shop.id) && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {selected.has(shop.id) && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{shop.connectionName}</span>
                  <span className="text-muted-foreground"> · {shop.name}</span>
                </span>
                {shop.region && <Badge variant="muted">{shop.region}</Badge>}
              </button>
            ))
          )}
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between border-t px-3 py-1.5">
            <Button variant="ghost" size="sm" onClick={toggleAllFiltered}>
              {allFilteredSelected
                ? t('listing.custom.deselectAll')
                : t('listing.custom.selectAllFiltered', { count: filtered.length })}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('listing.custom.selectedCount', { count: value.length })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
