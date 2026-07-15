import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { env } from '@/lib/env';

/**
 * Layout cho nhóm route xác thực (/login, /register) — căn giữa, nền nhẹ.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <div className="flex items-center gap-2 text-foreground">
        <Layers className="size-6 text-primary" />
        <span className="text-lg font-semibold">{env.appName}</span>
      </div>
      {children}
    </div>
  );
}
