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
import { getApiFieldErrors } from '@/utils/http';
import { createLoginSchema, type LoginInput } from '../schemas/auth.schema';
import { useLogin } from '../hooks/use-login';

export function LoginForm() {
  const { t } = useTranslation('auth');
  const { t: tv } = useTranslation('validation');
  const translateApiError = useApiError();
  const [showPassword, setShowPassword] = useState(false);
  const mutation = useLogin();

  // Tạo lại schema khi đổi ngôn ngữ để thông báo lỗi cũng đổi theo.
  const schema = useMemo(() => createLoginSchema(tv), [tv]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      const fieldErrors = getApiFieldErrors(error);
      const fields = Object.keys(fieldErrors);
      if (fields.length > 0) {
        fields.forEach((field) =>
          setError(field as keyof LoginInput, { message: fieldErrors[field] }),
        );
      } else {
        // 401 trung tính (chống enumeration) → thông báo chung.
        toast.error(t('login.failed'), { description: translateApiError(error) });
      }
    }
  };

  const isLoading = mutation.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">
          {t('login.email')} <span className="text-destructive">*</span>
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

      <div className="space-y-2">
        <Label htmlFor="password">
          {t('login.password')} <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="current-password"
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
        {isLoading ? t('login.submitting') : t('login.submit')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('login.noAccount')}{' '}
        <Link
          href="/register"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('login.registerLink')}
        </Link>
      </p>
    </form>
  );
}
