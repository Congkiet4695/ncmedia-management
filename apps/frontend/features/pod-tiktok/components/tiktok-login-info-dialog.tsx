'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useRevealPodTiktokCredentials, useUpdatePodTiktokLoginInfo } from '../hooks/use-pod-tiktok';
import {
  buildLoginInfoPayload,
  createTiktokLoginInfoSchema,
  type TiktokLoginInfoInput,
} from '../schemas/pod-tiktok.schema';
import type { PodTiktokAccountCredentials, PodTiktokAccountListItem } from '../types';

interface TiktokLoginInfoDialogProps {
  /** Kết nối đang sửa; `null` = đóng. */
  account: PodTiktokAccountListItem | null;
  /** `pod.tiktok.account.update` — không có ⇒ chỉ xem. */
  canEdit: boolean;
  /** `pod.tiktok.account.credentials.read` — được xem Password / 2FA đã lưu. */
  canReveal: boolean;
  onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

/**
 * Dialog sửa Tiktok mail · Password tiktok · 2FA Code · Ngày về tiền.
 *
 * 🔴 Bảo mật credential:
 *  - Ô Password / 2FA LUÔN trống khi mở (backend không trả giá trị đã lưu); để trống = GIỮ NGUYÊN. Muốn xoá phải
 *    tick "Xoá" tường minh — một ô trống không bao giờ vô tình xoá mật khẩu.
 *  - Xem giá trị đã lưu: nút riêng, chỉ hiện khi có quyền; kết quả chỉ nằm trong state của dialog, mất khi đóng
 *    (không cache, không localStorage, không URL).
 *  - Lưu = MỘT request PATCH chỉ chứa các trường thật sự đổi.
 */
export function TiktokLoginInfoDialog({ account, canEdit, canReveal, onClose }: TiktokLoginInfoDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { t: tv } = useTranslation('validation');
  const translateApiError = useApiError();
  const schema = useMemo(() => createTiktokLoginInfoSchema(tv), [tv]);
  const update = useUpdatePodTiktokLoginInfo();
  const reveal = useRevealPodTiktokCredentials();
  const [revealed, setRevealed] = useState<PodTiktokAccountCredentials | null>(null);
  const [showTyped, setShowTyped] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TiktokLoginInfoInput>({ resolver: zodResolver(schema) });

  // Mỗi lần mở (hoặc đổi sang kết nối khác) phải sạch: không mang giá trị / credential của dòng trước.
  useEffect(() => {
    if (!account) return;
    reset({
      tiktokMail: account.tiktokMail ?? '',
      tiktokPassword: '',
      clearPassword: false,
      tiktokTwoFactorCode: '',
      clearTwoFactorCode: false,
      moneyReturnDate: account.moneyReturnDate ?? '',
    });
    setRevealed(null);
    setShowTyped(false);
    reveal.reset();
    // `reveal.reset` ổn định; chỉ chạy lại khi đổi kết nối.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, reset]);

  const handleClose = () => {
    setRevealed(null);
    reveal.reset();
    onClose();
  };

  const handleReveal = async () => {
    if (!account) return;
    try {
      setRevealed(await reveal.mutateAsync(account.id));
    } catch (error) {
      toast.error(t('account.loginInfo.revealFailed'), { description: translateApiError(error) });
    }
  };

  const onSubmit = async (values: TiktokLoginInfoInput) => {
    if (!account) return;
    // Chốt id NGAY lúc bấm Lưu — đổi trang / đổi dòng giữa chừng cũng không ghi nhầm kết nối.
    const accountId = account.id;
    const payload = buildLoginInfoPayload(values, account);
    if (Object.keys(payload).length === 0) {
      toast.info(t('account.loginInfo.noChanges'));
      handleClose();
      return;
    }
    try {
      await update.mutateAsync({ id: accountId, payload });
      toast.success(t('account.loginInfo.saved'), { description: account.accountName });
      handleClose();
    } catch (error) {
      toast.error(t('account.loginInfo.saveFailed'), { description: translateApiError(error) });
    }
  };

  const clearPassword = watch('clearPassword');
  const clearTwoFactor = watch('clearTwoFactorCode');
  const moneyReturnDate = watch('moneyReturnDate');
  const disabled = !canEdit || update.isPending;
  const secretType = showTyped ? 'text' : 'password';

  return (
    <Modal
      open={Boolean(account)}
      onClose={handleClose}
      title={t('account.loginInfo.title')}
      description={account?.accountName}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={update.isPending}>
            {canEdit ? t('common:action.cancel') : t('common:action.close')}
          </Button>
          {canEdit && (
            <Button type="submit" form="tiktok-login-info-form" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" />}
              {t('common:action.save')}
            </Button>
          )}
        </div>
      }
    >
      <form id="tiktok-login-info-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" autoComplete="off">
        <div className="space-y-2">
          <Label htmlFor="tiktokMail">{t('account.loginInfo.mail')}</Label>
          <Input
            id="tiktokMail"
            type="email"
            placeholder="seller@example.com"
            disabled={disabled}
            {...register('tiktokMail')}
          />
          <FieldError message={errors.tiktokMail?.message} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="tiktokPassword">{t('account.loginInfo.password')}</Label>
            {canEdit && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowTyped((value) => !value)}
              >
                {showTyped ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {showTyped ? t('account.loginInfo.hideTyped') : t('account.loginInfo.showTyped')}
              </button>
            )}
          </div>
          <Input
            id="tiktokPassword"
            type={secretType}
            autoComplete="new-password"
            placeholder={
              account?.hasTiktokPassword ? t('account.loginInfo.keepPlaceholder') : t('account.loginInfo.emptyPlaceholder')
            }
            disabled={disabled || clearPassword}
            {...register('tiktokPassword')}
          />
          <FieldError message={errors.tiktokPassword?.message} />
          {canEdit && account?.hasTiktokPassword && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={clearPassword}
                onChange={(event) => setValue('clearPassword', event.target.checked)}
              />
              {t('account.loginInfo.clearPassword')}
            </label>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tiktokTwoFactorCode">{t('account.loginInfo.twoFactor')}</Label>
          <Input
            id="tiktokTwoFactorCode"
            type={secretType}
            autoComplete="off"
            placeholder={
              account?.hasTiktokTwoFactorCode
                ? t('account.loginInfo.keepPlaceholder')
                : t('account.loginInfo.emptyPlaceholder')
            }
            disabled={disabled || clearTwoFactor}
            {...register('tiktokTwoFactorCode')}
          />
          <FieldError message={errors.tiktokTwoFactorCode?.message} />
          <p className="text-xs text-muted-foreground">{t('account.loginInfo.twoFactorHint')}</p>
          {canEdit && account?.hasTiktokTwoFactorCode && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={clearTwoFactor}
                onChange={(event) => setValue('clearTwoFactorCode', event.target.checked)}
              />
              {t('account.loginInfo.clearTwoFactor')}
            </label>
          )}
        </div>

        {canReveal && (account?.hasTiktokPassword || account?.hasTiktokTwoFactorCode) && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            {revealed ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1 text-xs font-medium">
                    <ShieldCheck className="size-3.5" />
                    {t('account.loginInfo.revealedTitle')}
                  </p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(null)}>
                    <EyeOff className="size-3.5" />
                    {t('account.loginInfo.hideRevealed')}
                  </Button>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t('account.loginInfo.password')}</dt>
                  <dd className="break-all font-mono">{revealed.tiktokPassword ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('account.loginInfo.twoFactor')}</dt>
                  <dd className="break-all font-mono">{revealed.tiktokTwoFactorCode ?? '—'}</dd>
                </dl>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => void handleReveal()} disabled={reveal.isPending}>
                {reveal.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                {t('account.loginInfo.reveal')}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">{t('account.loginInfo.revealHint')}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="moneyReturnDate">{t('account.loginInfo.moneyReturnDate')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="moneyReturnDate"
              type="date"
              className="w-[200px]"
              disabled={disabled}
              {...register('moneyReturnDate')}
            />
            {canEdit && moneyReturnDate && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('account.loginInfo.clearDate')}
                title={t('account.loginInfo.clearDate')}
                onClick={() => setValue('moneyReturnDate', '', { shouldDirty: true })}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <FieldError message={errors.moneyReturnDate?.message} />
        </div>
      </form>
    </Modal>
  );
}
