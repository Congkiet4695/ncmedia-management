'use client';

import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';

interface RequirePermissionProps {
  /** Mã permission `resource.action` bắt buộc để truy cập. */
  permission: string;
  children: ReactNode;
  /** Thông báo khi thiếu quyền (mặc định chung chung). */
  message?: string;
}

/**
 * RequirePermission — guard UI **theo permission** (không hardcode role).
 * Thiếu quyền → hiển thị 403 với thông báo phù hợp từng khu vực.
 */
export function RequirePermission({ permission, children, message }: RequirePermissionProps) {
  const { t } = useTranslation();
  const { loading, hasPermission } = useAuth();

  if (loading) return null; // AuthProvider đã hiển thị loading toàn cục

  if (!hasPermission(permission)) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h2 className="text-lg font-semibold">{t('state.forbiddenTitle')}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {message ?? t('state.forbiddenMessage')}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
