'use client';

import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

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
        <Avatar src={user.avatar} name={user.fullName} className="size-14 text-lg" />
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
