'use client';

import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatVnd } from '@/lib/format';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
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
  const { t } = useTranslation('profile');
  const translateApiError = useApiError();
  const { formatDate } = useLocaleFormat();
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
        {translateApiError(error)}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Thông tin tài khoản — read-only (do Admin/HR quản lý) */}
      <Card>
        <CardHeader>
          <CardTitle>{t('accountInfo')}</CardTitle>
          <CardDescription>{t('accountInfoHint')}</CardDescription>
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
            <ReadonlyItem label={t('role')} value={profile.role.name} />
            <ReadonlyItem label={t('organization')} value={profile.organization.name} />
            <ReadonlyItem label={t('department')} value={profile.department ?? '—'} />
            <ReadonlyItem
              label={t('salary')}
              value={profile.salary != null ? formatVnd(profile.salary) : '—'}
            />
            <ReadonlyItem label={t('startDate')} value={formatDate(profile.startDate)} />
            <ReadonlyItem label="CCCD" value={profile.cccd ?? '—'} />
          </dl>
        </CardContent>
      </Card>

      {/* Thông tin cá nhân — editable */}
      <Card>
        <CardHeader>
          <CardTitle>{t('personalInfo')}</CardTitle>
          <CardDescription>{t('personalInfoHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} />
        </CardContent>
      </Card>

      {/* Đổi mật khẩu */}
      <Card>
        <CardHeader>
          <CardTitle>{t('changePassword')}</CardTitle>
          <CardDescription>{t('changePasswordHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
