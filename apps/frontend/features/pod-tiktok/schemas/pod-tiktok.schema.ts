import { z } from 'zod';
import type { TFunction } from 'i18next';

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
