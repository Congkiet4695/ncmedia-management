'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/require-permission';
import { CustomListingForm } from '@/features/pod-listing-session/components/custom-listing-form';

/**
 * **POD → Auto Listing → Edit Custom Listing**.
 *
 * Cùng một form với màn hình tạo (`/custom`), chỉ khác là nạp sẵn lượt đăng + Draft Product
 * đã lưu và mọi lần Lưu là `PATCH /pod/listing-sessions/:id/custom` — sửa TẠI CHỖ, không
 * tạo thêm bản nháp. Sửa được đầy đủ đúng những gì lúc tạo nhập được.
 *
 * 🔴 Quyền `pod.session.write`; nút "Đăng sản phẩm" bên trong còn cần `pod.listing.run`.
 */
export default function EditCustomListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation('pod');
  const { id } = use(params);
  return (
    <RequirePermission permission="pod.session.write" message={t('listing.common.noPermission')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('listing.custom.editTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('listing.custom.editSubtitle')}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/dashboard/pod/auto-listing/${id}`}>
              <ArrowLeft className="size-4" />
              {t('listing.custom.backToSession')}
            </Link>
          </Button>
        </div>

        <CustomListingForm sessionId={id} />
      </div>
    </RequirePermission>
  );
}
