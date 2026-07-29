'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  accountFormSchema,
  type AccountFormInput,
} from '../schemas/account.schema';
import type { AccountPlatform, SellerOption } from '../types';

interface AccountFormProps {
  mode: 'create' | 'edit';
  platforms: AccountPlatform[];
  sellers: SellerOption[];
  /** Hiển thị field gán Seller — chỉ user có quyền chọn Seller (ADMIN). EMPLOYEE: ẩn. */
  showSeller?: boolean;
  submitting?: boolean;
  defaultValues?: Partial<AccountFormInput>;
  onSubmit: (values: AccountFormInput) => void;
}

const BASE_DEFAULTS: AccountFormInput = {
  name: '',
  platformId: '',
  loginTool: '',
  sellerUserId: '',
  status: 'NEW',
  issuedAt: '',
  activatedAt: '',
  diedBlankAt: '',
  diedAt: '',
  moneyReturnedAt: '',
  dieReason: '',
  holdAmount: '0',
  netAmount: '0',
  paidAmount: '0',
  proxy: '',
  docsUrl: '',
  note: '',
  note2: '',
};

/** Các ô nhập tiền (USD) — dùng chung cấu hình để không lặp code. */
const AMOUNT_FIELDS = [
  { name: 'holdAmount', label: 'Hold Amount' },
  { name: 'netAmount', label: 'Net Amount' },
  { name: 'paidAmount', label: 'Paid Amount' },
] as const satisfies ReadonlyArray<{ name: keyof AccountFormInput; label: string }>;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

export function AccountForm({
  mode,
  platforms,
  sellers,
  showSeller = false,
  submitting,
  defaultValues,
  onSubmit,
}: AccountFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormInput>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { ...BASE_DEFAULTS, ...defaultValues },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">
            Tên Account <span className="text-destructive">*</span>
          </Label>
          <Input id="name" disabled={submitting} aria-invalid={!!errors.name} {...register('name')} />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="platformId">Nền tảng</Label>
          <NativeSelect id="platformId" disabled={submitting} {...register('platformId')}>
            <option value="">— Chọn nền tảng —</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        {showSeller && (
          <div className="space-y-2">
            <Label htmlFor="sellerUserId">Seller quản lý</Label>
            <NativeSelect id="sellerUserId" disabled={submitting} {...register('sellerUserId')}>
              <option value="">— Chưa gán —</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.email})
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="status">Trạng thái</Label>
          <NativeSelect id="status" disabled={submitting} {...register('status')}>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACCOUNT_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <Label htmlFor="loginTool">Tool đăng nhập</Label>
          <Input id="loginTool" placeholder="Hidemyacc…" disabled={submitting} {...register('loginTool')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="issuedAt">Ngày cấp</Label>
          <Input id="issuedAt" type="date" disabled={submitting} {...register('issuedAt')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="activatedAt">Ngày hoạt động</Label>
          <Input id="activatedAt" type="date" disabled={submitting} {...register('activatedAt')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="diedBlankAt">Ngày die trắng</Label>
          <Input id="diedBlankAt" type="date" disabled={submitting} {...register('diedBlankAt')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="diedAt">Ngày die</Label>
          <Input id="diedAt" type="date" disabled={submitting} {...register('diedAt')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="moneyReturnedAt">Ngày về tiền</Label>
          <Input id="moneyReturnedAt" type="date" disabled={submitting} {...register('moneyReturnedAt')} />
        </div>

        {AMOUNT_FIELDS.map((field) => (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={field.name}>{field.label} ($)</Label>
            <Input
              id={field.name}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              disabled={submitting}
              aria-invalid={!!errors[field.name]}
              {...register(field.name)}
            />
            <FieldError message={errors[field.name]?.message} />
          </div>
        ))}

        <div className="space-y-2">
          <Label htmlFor="proxy">Proxy</Label>
          <Input id="proxy" disabled={submitting} {...register('proxy')} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="dieReason">Lý do die</Label>
          <Input id="dieReason" disabled={submitting} {...register('dieReason')} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="docsUrl">Docs (URL)</Label>
          <Input id="docsUrl" placeholder="https://…" disabled={submitting} {...register('docsUrl')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="note">Ghi chú</Label>
          <Input id="note" disabled={submitting} {...register('note')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="note2">Ghi chú 2</Label>
          <Input id="note2" disabled={submitting} {...register('note2')} />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {mode === 'edit' ? 'Lưu thay đổi' : 'Tạo Account'}
        </Button>
      </div>
    </form>
  );
}
