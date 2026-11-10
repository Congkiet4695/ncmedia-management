'use client';

import { useEffect, useState } from 'react';
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import { useUpdateOrganizationPlan } from '../hooks';
import type { OrganizationRow } from '../types';

/** Trần nhập tay — khớp `ORGANIZATION_MAX_SHOP_LIMIT` ở backend (chặn gõ nhầm, không phải luật nghiệp vụ). */
const MAX_SHOP_LIMIT = 100_000;

/** "3 / 10" — Shop đang kết nối / giới hạn. Đạt hoặc vượt giới hạn ⇒ màu cảnh báo. */
export function ShopUsageCell({ organization }: { organization: OrganizationRow }) {
  const { t } = useTranslation('superAdmin');
  const { formatNumber } = useLocaleFormat();
  if (organization.shopLimit === null) {
    return <span className="text-sm text-muted-foreground">{t('organizations.noPlan')}</span>;
  }
  const full = organization.connectedShopCount >= organization.shopLimit;
  return (
    <span className={cn('whitespace-nowrap text-sm tabular-nums', full && 'font-semibold text-destructive')}>
      {formatNumber(organization.connectedShopCount)} / {formatNumber(organization.shopLimit)}
    </span>
  );
}

/** "30/11/2026" hoặc "30/11/2026 — Đã hết hạn". */
export function ExpiryCell({ organization }: { organization: OrganizationRow }) {
  const { t } = useTranslation('superAdmin');
  const { formatDate } = useLocaleFormat();
  if (!organization.expiresAt) {
    return <span className="text-sm text-muted-foreground">{t('organizations.noPlan')}</span>;
  }
  return (
    <span className={cn('whitespace-nowrap text-sm', organization.expired && 'font-semibold text-destructive')}>
      {formatDate(organization.expiresAt)}
      {organization.expired && ` — ${t('organizations.expired')}`}
    </span>
  );
}

/** ISO → giá trị `datetime-local` theo giờ máy (cùng múi giờ màn hình dùng để hiển thị ngày). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Sửa gói: số Shop tối đa + ngày hết hạn. Chỉ gửi phần đã đổi (mỗi phần một API ⇒ nhật ký ghi đúng từng thay đổi).
 * Backend kiểm lại toàn bộ (số nguyên > 0, ngày hợp lệ, không trước ngày đăng ký) — kiểm ở đây chỉ để báo sớm.
 */
export function OrganizationPlanDialog({
  organization,
  onClose,
}: {
  organization: OrganizationRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['superAdmin', 'common']);
  const translateApiError = useApiError();
  const mutation = useUpdateOrganizationPlan();
  const [limit, setLimit] = useState('');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organization) return;
    setLimit(organization.shopLimit === null ? '' : String(organization.shopLimit));
    setExpires(toLocalInput(organization.expiresAt));
    setError(null);
  }, [organization]);

  if (!organization) return null;

  const submit = () => {
    const parsedLimit = Number(limit);
    if (!/^\d+$/.test(limit.trim()) || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_SHOP_LIMIT) {
      setError(t('plan.invalidLimit'));
      return;
    }
    const expiresDate = new Date(expires); // `YYYY-MM-DDTHH:mm` ⇒ hiểu theo giờ máy
    if (!expires || Number.isNaN(expiresDate.getTime())) {
      setError(t('plan.invalidDate'));
      return;
    }
    const limitChanged = parsedLimit !== organization.shopLimit;
    const expiresChanged = expires !== toLocalInput(organization.expiresAt);
    if (!limitChanged && !expiresChanged) {
      setError(t('plan.noChange'));
      return;
    }
    setError(null);
    void mutation
      .mutateAsync({
        id: organization.id,
        shopLimit: limitChanged ? parsedLimit : undefined,
        expiresAt: expiresChanged ? expiresDate.toISOString() : undefined,
      })
      .then(() => {
        toast.success(t('plan.done', { name: organization.name }));
        onClose();
      })
      .catch((err: unknown) => setError(translateApiError(err)));
  };

  return (
    <Modal open onClose={onClose} title={t('plan.title', { name: organization.name })} className="max-w-md">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="plan-shop-limit">{t('plan.shopLimit')}</Label>
          <Input
            id="plan-shop-limit"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SHOP_LIMIT}
            step={1}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t('plan.shopLimitHint', { count: organization.connectedShopCount })}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-expires-at">{t('plan.expiresAt')}</Label>
          <Input
            id="plan-expires-at"
            type="datetime-local"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('plan.expiresAtHint')}</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('plan.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Xác nhận Kích hoạt / Vô hiệu hoá — cả hai đều đổi quyền truy cập của cả tổ chức nên không để sau một cú bấm đơn. */
export function OrganizationActiveDialog({
  organization,
  activate,
  pending,
  onConfirm,
  onClose,
}: {
  organization: OrganizationRow | null;
  activate: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['superAdmin', 'common']);
  if (!organization) return null;
  const key = activate ? 'activate' : 'deactivate';

  return (
    <Modal open onClose={onClose} title={t(`${key}.title`)} className="max-w-md">
      <div className="space-y-4">
        <div className="flex gap-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              activate ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
            )}
          >
            {activate ? <PlayCircle className="size-5" /> : <PauseCircle className="size-5" />}
          </div>
          <div className="space-y-1">
            <p className="text-sm">{t(`${key}.confirm`, { name: organization.name })}</p>
            <p className="text-xs text-muted-foreground">{t(`${key}.hint`)}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:action.cancel')}
          </Button>
          <Button variant={activate ? 'success' : 'destructive'} onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t(`${key}.submit`)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
