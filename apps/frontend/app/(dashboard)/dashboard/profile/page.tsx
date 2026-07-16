'use client';

import { Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatVnd } from '@/lib/format';
import { getApiErrorMessage } from '@/utils/http';
import { ChangePasswordForm } from '@/features/profile/components/change-password-form';
import { ProfileForm } from '@/features/profile/components/profile-form';
import { useProfile } from '@/features/profile/hooks/use-profile';

function ReadonlyItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const { data: profile, isLoading, isError, error } = useProfile();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {getApiErrorMessage(error, 'Không tải được hồ sơ')}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hồ sơ của tôi</h1>
        <p className="text-sm text-muted-foreground">Xem và cập nhật thông tin cá nhân của bạn.</p>
      </div>

      {/* Thông tin tài khoản — read-only (do Admin/HR quản lý) */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin tài khoản</CardTitle>
          <CardDescription>Các thông tin dưới đây do quản trị viên quản lý.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={profile.avatar} name={profile.fullName} className="size-12" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{profile.fullName}</p>
              <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
            </div>
            <div className="ml-auto">
              <Badge variant="muted">{profile.status}</Badge>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <ReadonlyItem label="Vai trò" value={profile.role.name} />
            <ReadonlyItem label="Tổ chức" value={profile.organization.name} />
            <ReadonlyItem label="Phòng" value={profile.department ?? '—'} />
            <ReadonlyItem
              label="Lương"
              value={profile.salary != null ? formatVnd(profile.salary) : '—'}
            />
            <ReadonlyItem label="Ngày vào làm" value={formatDate(profile.startDate)} />
            <ReadonlyItem label="CCCD" value={profile.cccd ?? '—'} />
          </dl>
        </CardContent>
      </Card>

      {/* Thông tin cá nhân — editable */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin cá nhân</CardTitle>
          <CardDescription>Bạn có thể tự cập nhật các thông tin này.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} />
        </CardContent>
      </Card>

      {/* Đổi mật khẩu */}
      <Card>
        <CardHeader>
          <CardTitle>Đổi mật khẩu</CardTitle>
          <CardDescription>Cập nhật mật khẩu đăng nhập của bạn.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
