'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiError } from '@/hooks/use-api-error';
import { getApiErrorCode, getApiFieldErrors } from '@/utils/http';
import {
  createChangePasswordSchema,
  type ChangePasswordFormInput,
} from '../schemas/profile.schema';
import { useChangePassword } from '../hooks/use-profile';

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

export function ChangePasswordForm() {
  const { t } = useTranslation('profile');
  const { t: tv } = useTranslation('validation');
  const translateApiError = useApiError();
  const schema = useMemo(() => createChangePasswordSchema(tv), [tv]);
  const mutation = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordFormInput>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: ChangePasswordFormInput) => {
    try {
      await mutation.mutateAsync(values);
      toast.success(t('passwordChanged'));
      reset();
    } catch (error) {
      const fieldErrors = getApiFieldErrors(error);
      const fields = Object.keys(fieldErrors);
      if (fields.length > 0) {
        fields.forEach((f) =>
          setError(f as keyof ChangePasswordFormInput, { message: fieldErrors[f] }),
        );
      } else if (getApiErrorCode(error) === 'AUTH_INVALID_CREDENTIALS') {
        setError('currentPassword', { message: tv('passwordIncorrect') });
      } else {
        toast.error(t('changePasswordFailed'), { description: translateApiError(error) });
      }
    }
  };

  const submitting = mutation.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="currentPassword">
          {t('currentPassword')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          disabled={submitting}
          aria-invalid={!!errors.currentPassword}
          {...register('currentPassword')}
        />
        <FieldError message={errors.currentPassword?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">
          {t('newPassword')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          disabled={submitting}
          aria-invalid={!!errors.newPassword}
          {...register('newPassword')}
        />
        <FieldError message={errors.newPassword?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">
          {t('confirmNewPassword')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          disabled={submitting}
          aria-invalid={!!errors.confirmPassword}
          {...register('confirmPassword')}
        />
        <FieldError message={errors.confirmPassword?.message} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {t('changePassword')}
        </Button>
      </div>
    </form>
  );
}
