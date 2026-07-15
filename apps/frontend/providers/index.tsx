'use client';

import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from './query-provider';
import { AuthProvider } from './auth-provider';

/**
 * Gom toàn bộ client-side provider vào một nơi.
 * - QueryProvider: TanStack React Query (AuthProvider phụ thuộc — dùng useMe).
 * - AuthProvider: khởi tạo phiên (GET /me) + Loading Screen.
 * - Toaster (sonner): đặt ngoài AuthProvider để toast hiển thị cả khi đang loading.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>{children}</AuthProvider>
      <Toaster richColors closeButton position="top-right" />
    </QueryProvider>
  );
}
