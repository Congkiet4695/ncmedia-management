'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../schemas/order.schema';
import type { OrderSellerOption, OrderStatus } from '../types';

interface PlatformOption {
  id: string;
  name: string;
}
interface AccountOption {
  id: string;
  name: string;
}

interface OrderFilterProps {
  search: string;
  status?: OrderStatus;
  platformId?: string;
  accountId?: string;
  supplier: string;
  sellerUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  platforms: PlatformOption[];
  accounts: AccountOption[];
  sellers: OrderSellerOption[];
  /** Hiển thị filter Seller — chỉ ADMIN. EMPLOYEE: ẩn hoàn toàn (không gọi API Seller). */
  showSeller?: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value?: OrderStatus) => void;
  onPlatformChange: (value?: string) => void;
  onAccountChange: (value?: string) => void;
  onSupplierChange: (value: string) => void;
  onSellerChange: (value?: string) => void;
  onDateFromChange: (value?: string) => void;
  onDateToChange: (value?: string) => void;
}

export function OrderFilter({
  search,
  status,
  platformId,
  accountId,
  supplier,
  sellerUserId,
  dateFrom,
  dateTo,
  platforms,
  accounts,
  sellers,
  showSeller = false,
  onSearchChange,
  onStatusChange,
  onPlatformChange,
  onAccountChange,
  onSupplierChange,
  onSellerChange,
  onDateFromChange,
  onDateToChange,
}: OrderFilterProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="flex-1 space-y-1.5 lg:min-w-56">
        <Label htmlFor="ord-search" className="text-xs text-muted-foreground">
          Tìm kiếm (Order Number / Tracking / Khách / SĐT / Địa chỉ)
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="ord-search"
            placeholder="Nhập từ khóa…"
            className="pl-9"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5 lg:w-40">
        <Label htmlFor="ord-status" className="text-xs text-muted-foreground">
          Trạng thái
        </Label>
        <NativeSelect
          id="ord-status"
          value={status ?? ''}
          onChange={(e) => onStatusChange((e.target.value || undefined) as OrderStatus | undefined)}
        >
          <option value="">Tất cả</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5 lg:w-40">
        <Label htmlFor="ord-platform" className="text-xs text-muted-foreground">
          Nền tảng
        </Label>
        <NativeSelect
          id="ord-platform"
          value={platformId ?? ''}
          onChange={(e) => onPlatformChange(e.target.value || undefined)}
        >
          <option value="">Tất cả</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5 lg:w-44">
        <Label htmlFor="ord-account" className="text-xs text-muted-foreground">
          Account
        </Label>
        <NativeSelect
          id="ord-account"
          value={accountId ?? ''}
          onChange={(e) => onAccountChange(e.target.value || undefined)}
        >
          <option value="">Tất cả</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5 lg:w-40">
        <Label htmlFor="ord-supplier" className="text-xs text-muted-foreground">
          Supplier
        </Label>
        <Input
          id="ord-supplier"
          placeholder="Supplier…"
          value={supplier}
          onChange={(e) => onSupplierChange(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 lg:w-40">
        <Label htmlFor="ord-date-from" className="text-xs text-muted-foreground">
          Từ ngày
        </Label>
        <Input
          id="ord-date-from"
          type="date"
          value={dateFrom ?? ''}
          onChange={(e) => onDateFromChange(e.target.value || undefined)}
        />
      </div>

      <div className="space-y-1.5 lg:w-40">
        <Label htmlFor="ord-date-to" className="text-xs text-muted-foreground">
          Đến ngày
        </Label>
        <Input
          id="ord-date-to"
          type="date"
          value={dateTo ?? ''}
          onChange={(e) => onDateToChange(e.target.value || undefined)}
        />
      </div>

      {showSeller && (
        <div className="space-y-1.5 lg:w-48">
          <Label htmlFor="ord-seller" className="text-xs text-muted-foreground">
            Seller
          </Label>
          <NativeSelect
            id="ord-seller"
            value={sellerUserId ?? ''}
            onChange={(e) => onSellerChange(e.target.value || undefined)}
          >
            <option value="">Tất cả</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
