import { z } from 'zod';
import type { TFunction } from 'i18next';
import type { PodTiktokLoginInfo, UpdatePodTiktokLoginInfoPayload } from '../types';

/**
 * Form Link Account — khớp `StartTiktokAuthorizationDto` của backend.
 *
 * 🔴 Chỉ còn MỘT trường: Account Name. Authorization Code đã bị loại bỏ hoàn toàn khỏi
 * giao diện — backend tự đổi code lấy token ở callback (yêu cầu App Review của TikTok).
 *
 * Nhận `t` để thông báo lỗi theo ngôn ngữ đang chọn (xem `features/auth/schemas`).
 */
export function createStartTiktokAuthorizationSchema(t: TFunction<'validation'>) {
  return z.object({
    accountName: z
      .string()
      .trim()
      .min(1, t('required'))
      .max(255, t('maxLength', { count: 255 })),
  });
}

export type StartTiktokAuthorizationInput = z.infer<
  ReturnType<typeof createStartTiktokAuthorizationSchema>
>;

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Form "Thông tin đăng nhập" của một TikTok Account — khớp `UpdatePodTiktokAccountLoginInfoDto`.
 *
 * Ô Password / 2FA LUÔN bắt đầu trống (backend không trả giá trị đã lưu): để trống = giữ nguyên;
 * xoá phải tick `clear*` tường minh.
 */
export function createTiktokLoginInfoSchema(t: TFunction<'validation'>) {
  return z.object({
    tiktokMail: z
      .string()
      .trim()
      .max(255, t('maxLength', { count: 255 }))
      .refine((value) => value === '' || z.string().email().safeParse(value).success, t('email')),
    tiktokPassword: z.string().max(256, t('maxLength', { count: 256 })),
    clearPassword: z.boolean(),
    tiktokTwoFactorCode: z.string().max(256, t('maxLength', { count: 256 })),
    clearTwoFactorCode: z.boolean(),
    moneyReturnDate: z
      .string()
      .refine((value) => value === '' || CALENDAR_DAY.test(value), t('invalidDate')),
  });
}

export type TiktokLoginInfoInput = z.infer<ReturnType<typeof createTiktokLoginInfoSchema>>;

/**
 * Payload PATCH CHỈ gồm các trường thật sự đổi so với dữ liệu đang hiển thị — sửa Ngày về tiền không gửi kèm
 * (và không bao giờ xoá) Password đã lưu. Trả `{}` khi không có gì đổi.
 */
export function buildLoginInfoPayload(
  values: TiktokLoginInfoInput,
  current: PodTiktokLoginInfo,
): UpdatePodTiktokLoginInfoPayload {
  const payload: UpdatePodTiktokLoginInfoPayload = {};
  const mail = values.tiktokMail.trim().toLowerCase();
  if (mail !== (current.tiktokMail ?? '')) payload.tiktokMail = mail === '' ? null : mail;

  if (values.clearPassword && current.hasTiktokPassword) payload.tiktokPassword = null;
  else if (values.tiktokPassword.trim() !== '') payload.tiktokPassword = values.tiktokPassword;

  if (values.clearTwoFactorCode && current.hasTiktokTwoFactorCode) payload.tiktokTwoFactorCode = null;
  else if (values.tiktokTwoFactorCode.trim() !== '') payload.tiktokTwoFactorCode = values.tiktokTwoFactorCode.trim();

  if (values.moneyReturnDate !== (current.moneyReturnDate ?? '')) {
    payload.moneyReturnDate = values.moneyReturnDate === '' ? null : values.moneyReturnDate;
  }
  return payload;
}
