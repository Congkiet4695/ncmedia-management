'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { getApiErrorCode, getApiErrorMessage } from '@/utils/http';

/** Tiền tố namespace chứa bản dịch của error code Backend. */
const SERVER_ERROR_PREFIX = 'validation:serverError.';

/**
 * Dịch lỗi API sang ngôn ngữ đang chọn.
 *
 * Thứ tự ưu tiên (đúng chủ trương "Backend trả code, Frontend dịch"):
 *  1. `code` nghiệp vụ trong envelope lỗi (vd `AUTH_INVALID_CREDENTIALS`) — dịch được.
 *  2. `message` do Backend trả về — dùng khi code chưa có bản dịch, để không mất thông tin.
 *  3. Thông báo lỗi hệ thống chung.
 *
 * Nhờ bước 2, thêm error code mới ở Backend KHÔNG làm vỡ giao diện: người dùng vẫn
 * đọc được lỗi, chỉ là chưa được bản địa hoá cho tới khi bổ sung khoá dịch.
 */
export function useApiError() {
  const { t } = useTranslation('validation');

  return useCallback(
    (error: unknown): string => {
      const code = getApiErrorCode(error);
      if (code && i18n.exists(`${SERVER_ERROR_PREFIX}${code}`)) {
        return t(`serverError.${code}`);
      }
      return getApiErrorMessage(error, t('serverError.INTERNAL_ERROR'));
    },
    [t],
  );
}
