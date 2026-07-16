'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS } from '../schemas/account.schema';
import type { AccountPlatform, AccountStatus, SellerOption } from '../types';

interface AccountFilterProps {
  search: string;
  status?: AccountStatus;
  platformId?: string;
  sellerUserId?: string;
  platforms: AccountPlatform[];
  sellers: SellerOption[];
  /** Hiển thị filter Seller — chỉ user có quyền chọn Seller (ADMIN). EMPLOYEE: ẩn hoàn toàn. */
  showSeller?: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value?: AccountStatus) => void;
  onPlatformChange: (value?: string) => void;
  onSellerChange: (value?: string) => void;
}

export function AccountFilter({
  search,
  status,
  platformId,
  sellerUserId,
  platforms,
  sellers,
  showSeller = false,
  onSearchChange,
  onStatusChange,
  onPlatformChange,
  onSellerChange,
}: AccountFilterProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div className="flex-1 space-y-1.5 lg:min-w-56">
        <Label htmlFor="acc-search" className="text-xs text-muted-foreground">
          Tìm kiếm (tên / ID chuẩn hoá)
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="acc-search"
            placeholder="Nhập từ khóa…"
            className="pl-9"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5 lg:w-40">
        <Label htmlFor="acc-status" className="text-xs text-muted-foreground">
          Trạng thái
        </Label>
        <NativeSelect
          id="acc-status"
          value={status ?? ''}
          onChange={(e) => onStatusChange((e.target.value || undefined) as AccountStatus | undefined)}
        >
          <option value="">Tất cả</option>
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5 lg:w-44">
        <Label htmlFor="acc-platform" className="text-xs text-muted-foreground">
          Nền tảng
        </Label>
        <NativeSelect
          id="acc-platform"
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

      {showSeller && (
        <div className="space-y-1.5 lg:w-48">
          <Label htmlFor="acc-seller" className="text-xs text-muted-foreground">
            Seller
          </Label>
          <NativeSelect
            id="acc-seller"
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
