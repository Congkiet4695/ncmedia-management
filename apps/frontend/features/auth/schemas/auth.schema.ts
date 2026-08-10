import { z } from 'zod';
import type { TFunction } from 'i18next';

/**
 * Zod schema cho Auth — luật khớp DTO Backend (auth.md Mục 17, Decision-002).
 * Client validate để UX; Backend vẫn là nguồn kiểm tra cuối cùng.
 *
 * Schema được tạo qua HÀM nhận `t` thay vì khai báo tĩnh: thông báo lỗi phải theo
 * ngôn ngữ người dùng đang chọn, mà `t` chỉ có ở runtime trong component.
 * Component gọi trong `useMemo([t])` để schema được tạo lại khi đổi ngôn ngữ.
 */

type ValidationT = TFunction<'validation'>;

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const NAME_MIN = 2;
const NAME_MAX = 255;

function passwordPolicy(t: ValidationT) {
  return z
    .string()
    .min(PASSWORD_MIN, t('passwordTooShort', { count: PASSWORD_MIN }))
    .max(PASSWORD_MAX, t('maxLength', { count: PASSWORD_MAX }))
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, t('passwordWeak'));
}

export function createLoginSchema(t: ValidationT) {
  return z.object({
    email: z.string().min(1, t('required')).email(t('email')).max(NAME_MAX),
    password: z.string().min(1, t('required')),
  });
}

export function createRegisterSchema(t: ValidationT) {
  return z.object({
    organizationName: z
      .string()
      .trim()
      .min(NAME_MIN, t('minLength', { count: NAME_MIN }))
      .max(NAME_MAX, t('maxLength', { count: NAME_MAX })),
    fullName: z
      .string()
      .trim()
      .min(NAME_MIN, t('minLength', { count: NAME_MIN }))
      .max(NAME_MAX, t('maxLength', { count: NAME_MAX })),
    email: z.string().min(1, t('required')).email(t('email')).max(NAME_MAX),
    password: passwordPolicy(t),
  });
}

export type LoginInput = z.infer<ReturnType<typeof createLoginSchema>>;
export type RegisterInput = z.infer<ReturnType<typeof createRegisterSchema>>;
