import type { ReactNode } from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { env } from '@/lib/env';

/**
 * Layout cho nhóm route xác thực (/login, /register) — căn giữa trên nền canvas, logo thương hiệu phía trên thẻ.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-foreground">
        <BrandLogo variant="full" size="auth" priority />
        <span className="text-center text-base font-semibold tracking-tight">{env.appName}</span>
      </div>
      {children}
    </div>
  );
}
