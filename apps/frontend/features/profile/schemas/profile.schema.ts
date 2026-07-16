import { z } from 'zod';

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ')
  .or(z.literal(''));

/** Form thông tin cá nhân (khớp UpdateProfileDto backend). */
export const profileFormSchema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(255, 'Tối đa 255 ký tự'),
  phone: z
    .string()
    .regex(/^[0-9+\-\s]{8,20}$/, 'Số điện thoại không hợp lệ')
    .or(z.literal('')),
  dateOfBirth: optionalDate,
  address: z.string().max(500, 'Tối đa 500 ký tự').or(z.literal('')),
  avatar: z.string().max(1024, 'Tối đa 1024 ký tự').or(z.literal('')),
  larkAccount: z.string().max(255, 'Tối đa 255 ký tự').or(z.literal('')),
  bankAccount: z.string().max(100, 'Tối đa 100 ký tự').or(z.literal('')),
  bankQrUrl: z.string().max(1024, 'Tối đa 1024 ký tự').or(z.literal('')),
});

export type ProfileFormInput = z.infer<typeof profileFormSchema>;

/** Form đổi mật khẩu (Decision-002: ≥8, có chữ + số). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    newPassword: z
      .string()
      .min(8, 'Mật khẩu tối thiểu 8 ký tự')
      .max(72, 'Mật khẩu tối đa 72 ký tự')
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Mật khẩu phải có ít nhất 1 chữ và 1 số'),
    confirmPassword: z.string().min(1, 'Vui lòng nhập lại mật khẩu mới'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Xác nhận mật khẩu không khớp',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
    path: ['newPassword'],
  });

export type ChangePasswordFormInput = z.infer<typeof changePasswordSchema>;
