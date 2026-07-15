'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

function initialsOf(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase() || 'U';
}

/** Thẻ tóm tắt phiên đăng nhập: Avatar, Fullname, Organization, Role (từ GET /me). */
export function ProfileSummary() {
  const { user, organization, role } = useAuth();
  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Phiên đăng nhập</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        {user.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar} alt={user.fullName} className="size-14 rounded-full object-cover" />
        ) : (
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {initialsOf(user.fullName)}
          </span>
        )}
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 text-muted-foreground">Họ và tên</dt>
            <dd className="font-medium">{user.fullName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 text-muted-foreground">Tổ chức</dt>
            <dd>{organization?.name ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 text-muted-foreground">Vai trò</dt>
            <dd>{role?.name ?? role?.code ?? '—'}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
