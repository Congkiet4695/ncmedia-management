'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorCode, getApiErrorMessage, getApiFieldErrors } from '@/utils/http';
import { registerSchema, type RegisterInput } from '../schemas/auth.schema';
import { useRegister } from '../hooks/use-register';

export function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false);
  const mutation = useRegister();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { organizationName: '', fullName: '', email: '', password: '' },
  });

  const onSubmit = async (values: RegisterInput) => {
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      const fieldErrors = getApiFieldErrors(error);
      const fields = Object.keys(fieldErrors);
      if (fields.length > 0) {
        fields.forEach((field) =>
          setError(field as keyof RegisterInput, { message: fieldErrors[field] }),
        );
      } else if (getApiErrorCode(error) === 'AUTH_EMAIL_EXISTS') {
        setError('email', { message: getApiErrorMessage(error) });
      } else {
        toast.error('Đăng ký thất bại', { description: getApiErrorMessage(error) });
      }
    }
  };

  const isLoading = mutation.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="organizationName">
          Tên tổ chức <span className="text-destructive">*</span>
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
          Họ và tên <span className="text-destructive">*</span>
        </Label>
        <Input
          id="fullName"
          placeholder="Nguyễn Văn A"
          autoComplete="name"
          disabled={isLoading}
          aria-invalid={!!errors.fullName}
          {...register('fullName')}
        />
        {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          Email <span className="text-destructive">*</span>
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
          Mật khẩu <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Tối thiểu 8 ký tự, có chữ và số"
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
            aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="animate-spin" />}
        Đăng ký
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Đã có tài khoản?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </form>
  );
}
