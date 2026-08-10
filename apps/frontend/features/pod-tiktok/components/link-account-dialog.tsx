'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { usePodTiktokAuthorizeUrl } from '../hooks/use-pod-tiktok';
import {
  createLinkTiktokAccountSchema,
  type LinkTiktokAccountInput,
} from '../schemas/pod-tiktok.schema';

interface LinkAccountDialogProps {
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (values: LinkTiktokAccountInput) => void;
}

const DEFAULTS: LinkTiktokAccountInput = { accountName: '', authorizationCode: '' };

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

/**
 * Dialog Link TikTok Shop Account.
 *
 * Luồng: Seller mở Authorization URL → đăng nhập TikTok → Approve →
 * TikTok redirect kèm tham số `code` → Seller copy `code` → dán vào ô Authorization Code.
 *
 * ⚠️ Authorization Code chỉ dùng được MỘT LẦN và hết hạn sau 30 phút (tài liệu TikTok).
 */
export function LinkAccountDialog({
  open,
  submitting,
  onClose,
  onSubmit,
}: LinkAccountDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { t: tv } = useTranslation('validation');
  const schema = useMemo(() => createLinkTiktokAccountSchema(tv), [tv]);
  const authorizeUrlQuery = usePodTiktokAuthorizeUrl(open);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LinkTiktokAccountInput>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
  });

  // Mỗi lần mở lại dialog phải sạch form — tránh gửi nhầm code cũ (code chỉ dùng 1 lần).
  useEffect(() => {
    if (open) reset(DEFAULTS);
  }, [open, reset]);

  const authorizeUrl = authorizeUrlQuery.data?.authorizeUrl;

  const handleCopyUrl = async () => {
    if (!authorizeUrl) return;
    try {
      await navigator.clipboard.writeText(authorizeUrl);
      toast.success(t('link.copySuccess'));
    } catch {
      toast.error(t('link.copyFailed'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('link.title')}
      description={t('link.description')}
    >
      <div className="space-y-5">
        {/* Bước 1 — hướng dẫn lấy Authorization Code */}
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{t('link.step1')}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>{t('link.step1Item1')}</li>
            <li>{t('link.step1Item2')}</li>
            <li>
              {t('link.step1Item3Prefix')} <code>code=...</code> {t('link.step1Item3Suffix')}{' '}
              <code>code</code>.
            </li>
          </ol>

          {authorizeUrlQuery.isLoading && (
            <p className="mt-3 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('link.loadingUrl')}
            </p>
          )}

          {authorizeUrlQuery.isError && (
            <p className="mt-3 text-destructive">
              {t('link.urlFailed')}
            </p>
          )}

          {authorizeUrl && (
            <div className="mt-3 space-y-2">
              <p className="break-all rounded bg-background p-2 font-mono text-xs">
                {authorizeUrl}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleCopyUrl}>
                  <Copy className="size-4" />
                  {t('link.copyUrl')}
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    {t('link.openAuthorize')}
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Bước 2 — nhập thông tin */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-sm font-medium">{t('link.step2')}</p>

          <div className="space-y-2">
            <Label htmlFor="accountName">
              {t('link.accountName')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountName"
              placeholder={t('link.accountNamePlaceholder')}
              autoComplete="off"
              {...register('accountName')}
            />
            <FieldError message={errors.accountName?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="authorizationCode">
              {t('link.authorizationCode')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="authorizationCode"
              placeholder={t('link.authorizationCodePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              {...register('authorizationCode')}
            />
            <FieldError message={errors.authorizationCode?.message} />
            <p className="text-xs text-muted-foreground">
              {t('link.codeHintPrefix')} <strong>{t('link.codeHintOnce')}</strong>{' '}
              {t('link.codeHintMiddle')} <strong>{t('link.codeHintMinutes')}</strong>.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              {t('link.submit')}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
