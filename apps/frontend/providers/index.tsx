'use client';

import { useEffect, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useThemeStore } from '@/stores/theme.store';
import { QueryProvider } from './query-provider';
import { AuthProvider } from './auth-provider';
import { I18nProvider } from './i18n-provider';

/**
 * Gom toàn bộ client-side provider vào một nơi.
 * - I18nProvider: đa ngôn ngữ (bọc NGOÀI CÙNG để cả màn hình loading lẫn toast đều dịch được).
 * - QueryProvider: TanStack React Query (AuthProvider phụ thuộc — dùng useMe).
 * - AuthProvider: khởi tạo phiên (GET /me) + Loading Screen.
 * - Theme: đồng bộ sáng/tối từ localStorage/hệ điều hành khi khởi động.
 * - Toaster (sonner): đặt ngoài AuthProvider để toast hiển thị cả khi đang loading.
 */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    useThemeStore.getState().init();
  }, []);

  return (
    <I18nProvider>
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
        <Toaster richColors closeButton position="top-right" />
      </QueryProvider>
    </I18nProvider>
  );
}
