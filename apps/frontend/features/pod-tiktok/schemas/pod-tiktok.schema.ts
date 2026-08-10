import { z } from 'zod';
import type { TFunction } from 'i18next';

/** Nhãn trạng thái kết nối nằm ở `pod.json` (khoá `account.status.*`). */

/**
 * Form Link Account — khớp `LinkTiktokAccountDto` của backend.
 * Cả hai trường đều bắt buộc theo yêu cầu Sprint 1.
 *
 * Nhận `t` để thông báo lỗi theo ngôn ngữ đang chọn (xem `features/auth/schemas`).
 */
export function createLinkTiktokAccountSchema(t: TFunction<'validation'>) {
  return z.object({
    accountName: z
      .string()
      .trim()
      .min(1, t('required'))
      .max(255, t('maxLength', { count: 255 })),
    authorizationCode: z
      .string()
      .trim()
      .min(1, t('required'))
      .max(512, t('maxLength', { count: 512 })),
  });
}

export type LinkTiktokAccountInput = z.infer<
  ReturnType<typeof createLinkTiktokAccountSchema>
>;
