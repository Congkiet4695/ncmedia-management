import { z } from 'zod';
import type { TFunction } from 'i18next';

/**
 * Schema hồ sơ cá nhân — tạo qua hàm nhận `t` để thông báo lỗi theo ngôn ngữ đang chọn
 * (cùng cách làm với `features/auth/schemas/auth.schema.ts`).
 */
type ValidationT = TFunction<'validation'>;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const NAME_MIN = 2;

/** Form thông tin cá nhân (khớp UpdateProfileDto backend). */
export function createProfileFormSchema(t: ValidationT) {
  const optionalDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t('invalidDate'))
    .or(z.literal(''));

  const max = (limit: number) =>
    z.string().max(limit, t('maxLength', { count: limit })).or(z.literal(''));

  return z.object({
    fullName: z
      .string()
      .trim()
      .min(NAME_MIN, t('minLength', { count: NAME_MIN }))
      .max(255, t('maxLength', { count: 255 })),
    phone: z
      .string()
      .regex(/^[0-9+\-\s]{8,20}$/, t('phone'))
      .or(z.literal('')),
    dateOfBirth: optionalDate,
    address: max(500),
    avatar: max(1024),
    larkAccount: max(255),
    bankAccount: max(100),
    bankQrUrl: max(1024),
  });
}

export type ProfileFormInput = z.infer<ReturnType<typeof createProfileFormSchema>>;

/** Form đổi mật khẩu (Decision-002: ≥8, có chữ + số). */
export function createChangePasswordSchema(t: ValidationT) {
  return z
    .object({
      currentPassword: z.string().min(1, t('required')),
      newPassword: z
        .string()
        .min(PASSWORD_MIN, t('passwordTooShort', { count: PASSWORD_MIN }))
        .max(PASSWORD_MAX, t('maxLength', { count: PASSWORD_MAX }))
        .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, t('passwordWeak')),
      confirmPassword: z.string().min(1, t('required')),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: t('passwordMismatch'),
      path: ['confirmPassword'],
    })
    .refine((d) => d.newPassword !== d.currentPassword, {
      message: t('passwordSameAsCurrent'),
      path: ['newPassword'],
    });
}

export type ChangePasswordFormInput = z.infer<ReturnType<typeof createChangePasswordSchema>>;
