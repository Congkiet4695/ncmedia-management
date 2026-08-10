'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { useLocaleStore } from '@/stores/locale.store';

/**
 * Cấp instance i18next cho toàn bộ cây component và khôi phục ngôn ngữ đã lưu.
 *
 * Dùng `useLayoutEffect` (không phải `useEffect`) để việc đổi ngôn ngữ xảy ra TRƯỚC khi
 * trình duyệt vẽ khung hình đầu tiên: lần render đầu vẫn trùng khớp với HTML do server
 * sinh ra (không lỗi hydration), nhưng người dùng cũng không kịp thấy tiếng Việt nhấp
 * nháy trước khi chuyển sang tiếng Anh.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    useLocaleStore.getState().init();
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
