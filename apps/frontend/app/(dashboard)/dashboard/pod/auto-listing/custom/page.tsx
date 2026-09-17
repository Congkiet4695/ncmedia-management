'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RequirePermission } from '@/components/require-permission';
import { CustomListingForm } from '@/features/pod-listing-session/components/custom-listing-form';

/**
 * **POD → Auto Listing → Add Custom Listing**.
 *
 * Màn hình RIÊNG cho việc nhập tay một sản phẩm rồi đăng lên nhiều shop — tách hẳn khỏi
 * luồng nạp CSV/Excel, nhưng ghi vào cùng `pod_listing_sessions` nên dùng chung toàn bộ
 * hàng đợi, retry, kết quả theo shop và phân quyền.
 *
 * 🔴 Quyền vào màn hình là `pod.session.write` (tạo lượt đăng + sản phẩm). Nút "Đăng sản
 * phẩm" bên trong còn cần `pod.listing.run` — hai việc khác nhau, gác riêng.
 */
export default function CustomListingPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.session.write" message={t('listing.common.noPermission')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('listing.custom.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('listing.custom.subtitle')}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/dashboard/pod/auto-listing">
              <ArrowLeft className="size-4" />
              {t('listing.custom.back')}
            </Link>
          </Button>
        </div>

        <CustomListingForm />
      </div>
    </RequirePermission>
  );
}
