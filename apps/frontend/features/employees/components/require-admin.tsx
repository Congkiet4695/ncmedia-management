'use client';

import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

/**
 * RequireAdmin — chỉ render children khi Role = ADMIN, ngược lại hiển thị 403.
 * Backend cũng chặn (AdminGuard → 403); đây là lớp UX phía client.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['employee', 'common']);
  const { role, loading } = useAuth();

  if (loading) return null; // AuthProvider đã hiển thị loading toàn cục

  if (role?.code !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h2 className="text-lg font-semibold">{t('common:state.forbiddenTitle')}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t('adminOnly')}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
