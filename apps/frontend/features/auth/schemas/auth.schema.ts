import { z } from 'zod';

/**
 * Zod schema cho Auth — luật khớp DTO Backend (auth.md Mục 17, Decision-002).
 * Client validate để UX; Backend vẫn là nguồn kiểm tra cuối cùng.
 */

const passwordPolicy = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(72, 'Mật khẩu tối đa 72 ký tự')
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Mật khẩu phải có ít nhất 1 chữ và 1 số');

export const loginSchema = z.object({
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ').max(255),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

export const registerSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, 'Tên tổ chức tối thiểu 2 ký tự')
    .max(255, 'Tên tổ chức tối đa 255 ký tự'),
  fullName: z
    .string()
    .trim()
    .min(2, 'Họ và tên tối thiểu 2 ký tự')
    .max(255, 'Họ và tên tối đa 255 ký tự'),
  email: z.string().min(1, 'Vui lòng nhập email').email('Email không hợp lệ').max(255),
  password: passwordPolicy,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
