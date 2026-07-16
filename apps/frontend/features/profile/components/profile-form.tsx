'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage } from '@/utils/http';
import { profileFormSchema, type ProfileFormInput } from '../schemas/profile.schema';
import { useUpdateProfile } from '../hooks/use-profile';
import type { Profile, UpdateProfileInput } from '../types';

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

/** Form cập nhật thông tin cá nhân (self-service). Không có role/status/email/salary. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const mutation = useUpdateProfile();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileFormInput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      fullName: profile.fullName,
      phone: profile.phone ?? '',
      dateOfBirth: profile.dateOfBirth ?? '',
      address: profile.address ?? '',
      avatar: profile.avatar ?? '',
      larkAccount: profile.larkAccount ?? '',
      bankAccount: profile.bankAccount ?? '',
      bankQrUrl: profile.bankQrUrl ?? '',
    },
  });

  const onSubmit = async (values: ProfileFormInput) => {
    // Bỏ field rỗng (backend validate định dạng; không gửi '' để tránh 400).
    const payload: UpdateProfileInput = {
      fullName: values.fullName,
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
      ...(values.address ? { address: values.address } : {}),
      ...(values.avatar ? { avatar: values.avatar } : {}),
      ...(values.larkAccount ? { larkAccount: values.larkAccount } : {}),
      ...(values.bankAccount ? { bankAccount: values.bankAccount } : {}),
      ...(values.bankQrUrl ? { bankQrUrl: values.bankQrUrl } : {}),
    };
    try {
      await mutation.mutateAsync(payload);
      toast.success('Cập nhật hồ sơ thành công');
    } catch (error) {
      toast.error('Cập nhật thất bại', { description: getApiErrorMessage(error) });
    }
  };

  const submitting = mutation.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">
            Họ và tên <span className="text-destructive">*</span>
          </Label>
          <Input id="fullName" disabled={submitting} aria-invalid={!!errors.fullName} {...register('fullName')} />
          <FieldError message={errors.fullName?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Số điện thoại</Label>
          <Input id="phone" disabled={submitting} aria-invalid={!!errors.phone} {...register('phone')} />
          <FieldError message={errors.phone?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="dateOfBirth">Ngày sinh</Label>
          <Input id="dateOfBirth" type="date" disabled={submitting} aria-invalid={!!errors.dateOfBirth} {...register('dateOfBirth')} />
          <FieldError message={errors.dateOfBirth?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="larkAccount">Account Lark</Label>
          <Input id="larkAccount" disabled={submitting} {...register('larkAccount')} />
          <FieldError message={errors.larkAccount?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bankAccount">Tài khoản ngân hàng</Label>
          <Input id="bankAccount" disabled={submitting} {...register('bankAccount')} />
          <FieldError message={errors.bankAccount?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bankQrUrl">QR Ngân hàng (URL)</Label>
          <Input id="bankQrUrl" placeholder="https://…" disabled={submitting} {...register('bankQrUrl')} />
          <FieldError message={errors.bankQrUrl?.message} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="address">Địa chỉ</Label>
          <Input id="address" disabled={submitting} {...register('address')} />
          <FieldError message={errors.address?.message} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="avatar">Avatar (URL)</Label>
          <Input id="avatar" placeholder="https://…" disabled={submitting} {...register('avatar')} />
          <FieldError message={errors.avatar?.message} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Lưu thay đổi
        </Button>
      </div>
    </form>
  );
}
