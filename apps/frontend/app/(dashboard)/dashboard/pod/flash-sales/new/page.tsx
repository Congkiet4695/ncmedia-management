'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import {
  FlashSaleForm,
  type FlashSaleFormValue,
} from '@/features/pod-flash-sale/components/flash-sale-form';
import { useCreateFlashSale } from '@/features/pod-flash-sale/hooks';
import { browserTimeZone, localToUtcIso } from '@/features/pod-flash-sale/timezone';

export default function NewFlashSalePage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.flashsale.write" message={t('flashSale.noPermission')}>
      <NewFlashSaleView />
    </RequirePermission>
  );
}

/**
 * **New Flash Sale** — bước 1: khai thông tin. Sản phẩm được thêm ở màn hình chi tiết.
 *
 * 🔴 Tách làm hai bước có chủ ý: đợt sale phải tồn tại (có id) trước khi thêm sản phẩm, vì
 * mỗi dòng sản phẩm là một bản ghi thật với giá đã tính. Gom vào một form khổng lồ rồi lưu
 * một lượt nghĩa là mất trắng công chọn 200 sản phẩm nếu trình duyệt đóng giữa chừng.
 *
 * Chọn sẵn một Template ở đây thì sản phẩm và giá được nạp ngay lúc tạo — đường "10 giây"
 * thứ hai bên cạnh Duplicate.
 */
function NewFlashSaleView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const create = useCreateFlashSale();

  const [value, setValue] = useState<FlashSaleFormValue>(() => ({
    shopId: '',
    name: '',
    description: '',
    startLocal: '',
    endLocal: '',
    timezone: browserTimeZone(),
    productLevel: 'VARIATION',
    templateId: '',
  }));

  const patch = (next: Partial<FlashSaleFormValue>): void =>
    setValue((current) => ({ ...current, ...next }));

  const startAt = localToUtcIso(value.startLocal, value.timezone);
  const endAt = localToUtcIso(value.endLocal, value.timezone);
  const ready = Boolean(value.shopId && value.name.trim() && startAt && endAt);

  const submit = (): void => {
    if (!ready || !startAt || !endAt) return;
    void create
      .mutateAsync({
        shopId: value.shopId,
        name: value.name.trim(),
        description: value.description.trim() || undefined,
        startAt,
        endAt,
        timezone: value.timezone,
        productLevel: value.productLevel,
        templateId: value.templateId || undefined,
      })
      .then((created) => {
        toast.success(t('flashSale.toast.created'));
        router.push(`/dashboard/pod/flash-sales/${created.id}`);
      })
      .catch((error: unknown) => toast.error(translateApiError(error)));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
            {t('common:action.back')}
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{t('flashSale.new.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('flashSale.new.subtitle')}</p>
        </div>
        <Button onClick={submit} disabled={!ready || create.isPending}>
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          {t('flashSale.new.submit')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('flashSale.new.section')}</h2>
        </CardHeader>
        <CardContent>
          <FlashSaleForm
            value={value}
            onChange={patch}
            mode="create"
            disabled={create.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}
