'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Card } from '@/components/ui/card';

/** Đường về sau khi kết thúc luồng uỷ quyền (trang quản lý kết nối TikTok). */
export const TIKTOK_ACCOUNTS_PATH = '/dashboard/pod/tiktok-accounts';

/** Namespace chứa bản dịch error code của Backend (dùng chung với `useApiError`). */
const SERVER_ERROR_PREFIX = 'validation:serverError.';

/**
 * Dịch mã lỗi nghiệp vụ (vd `POD_TIKTOK_INVALID_STATE`) sang thông điệp người dùng.
 *
 * Backend trả CODE, frontend dịch — nên thêm mã mới ở backend không làm vỡ giao diện:
 * mã chưa có bản dịch sẽ rơi về thông điệp chung thay vì hiển thị chuỗi kỹ thuật.
 */
export function useLinkErrorMessage(): (errorCode?: string | null) => string {
  const { t } = useTranslation(['pod', 'validation']);

  return useCallback(
    (errorCode?: string | null) => {
      if (errorCode && i18n.exists(`${SERVER_ERROR_PREFIX}${errorCode}`)) {
        return t(`validation:serverError.${errorCode}`);
      }
      return t('pod:linkResult.genericError');
    },
    [t],
  );
}

/**
 * Khung căn giữa dùng chung cho trang thành công và trang thất bại.
 *
 * Hai trang này nằm NGOÀI nhóm route `(dashboard)`: Seller tới đây từ redirect của TikTok
 * và có thể chưa đăng nhập hệ thống, nên không có sidebar và không có guard.
 */
export function LinkResultShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-lg">{children}</Card>
    </div>
  );
}
