'use client';

import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from './query-provider';

/**
 * Gom toàn bộ client-side provider vào một nơi.
 * - QueryProvider: TanStack React Query.
 * - Toaster (sonner): hệ thống Toast toàn cục.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </QueryProvider>
  );
}
