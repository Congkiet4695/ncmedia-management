'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiError } from '@/hooks/use-api-error';
import { getApiErrorCode, getApiFieldErrors } from '@/utils/http';
import { createRegisterSchema, type RegisterInput } from '../schemas/auth.schema';
import { useRegister } from '../hooks/use-register';
import type { RegisterOutcome } from './register-panel';

/**
 * Form đăng ký Organization.
 *
 * 🔴 KHÔNG đăng nhập sau khi gửi: Organization mới ở trạng thái PENDING nên vào Dashboard sẽ
 * bị chặn ngay. Form báo kết quả lên `onSubmitted`, và `RegisterPanel` đổi cả màn hình sang
 * trạng thái "chờ duyệt".
 */
export function RegisterForm({ onSubmitted }: { onSubmitted: (outcome: RegisterOutcome) => void }) {
  const { t } = useTranslation('auth');
  const { t: tv } = useTranslation('validation');
  const translateApiError = useApiError();
  const [showPassword, setShowPassword] = useState(false);
  const mutation = useRegister();

  // Tạo lại schema khi đổi ngôn ngữ để thông báo lỗi cũng đổi theo.
  const schema = useMemo(() => createRegisterSchema(tv), [tv]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(schema),
    defaultValues: { organizationName: '', fullName: '', email: '', phone: '', password: '' },
  });

  const onSubmit = async (values: RegisterInput) => {
    try {
      const result = await mutation.mutateAsync(values);
      onSubmitted({ email: result.user.email, emailSent: result.emailSent });
    } catch (error) {
      const fieldErrors = getApiFieldErrors(error);
      const fields = Object.keys(fieldErrors);
      if (fields.length > 0) {
        fields.forEach((field) =>
          setError(field as keyof RegisterInput, { message: fieldErrors[field] }),
        );
      } else if (getApiErrorCode(error) === 'AUTH_EMAIL_EXISTS') {
        setError('email', { message: translateApiError(error) });
      } else {
        toast.error(t('register.failed'), { description: translateApiError(error) });
      }
    }
  };

  const isLoading = mutation.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="organizationName">
          {t('register.organizationName')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="organizationName"
          placeholder="NCMedia Co."
          autoComplete="organization"
          disabled={isLoading}
          aria-invalid={!!errors.organizationName}
          {...register('organizationName')}
        />
        {errors.organizationName && (
          <p className="text-sm text-destructive">{errors.organizationName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">
          {t('register.fullName')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="fullName"
          placeholder={t('register.fullNamePlaceholder')}
          autoComplete="name"
          disabled={isLoading}
          aria-invalid={!!errors.fullName}
          {...register('fullName')}
        />
        {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          {t('register.email')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="admin@ncmedia.com"
          autoComplete="email"
          disabled={isLoading}
          aria-invalid={!!errors.email}
          {...register('email')}
        />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      {/* Tuỳ chọn — Super Admin dùng để liên hệ xác minh trước khi duyệt. */}
      <div className="space-y-2">
        <Label htmlFor="phone">
          {t('register.phone')}{' '}
          <span className="text-xs font-normal text-muted-foreground">
            {t('register.optional')}
          </span>
        </Label>
        <Input
          id="phone"
          type="tel"
          placeholder="0912345678"
          autoComplete="tel"
          disabled={isLoading}
          aria-invalid={!!errors.phone}
          {...register('phone')}
        />
        {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">
          {t('register.password')} <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder={t('register.passwordPlaceholder')}
            autoComplete="new-password"
            disabled={isLoading}
            aria-invalid={!!errors.password}
            className="pr-10"
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? t('password.hide') : t('password.show')}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="animate-spin" />}
        {isLoading ? t('register.submitting') : t('register.submit')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('register.hasAccount')}{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('register.loginLink')}
        </Link>
      </p>
    </form>
  );
}
