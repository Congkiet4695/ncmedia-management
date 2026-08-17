'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useStartTiktokAuthorization } from '../hooks/use-pod-tiktok';
import {
  createStartTiktokAuthorizationSchema,
  type StartTiktokAuthorizationInput,
} from '../schemas/pod-tiktok.schema';
import type { PodTiktokAuthorizeUrl } from '../types';

interface LinkAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULTS: StartTiktokAuthorizationInput = { accountName: '' };

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

/**
 * Dialog Link TikTok Shop Account.
 *
 * Hai bước, người dùng chỉ làm hai việc: **nhập Account Name** và **copy Authorization URL**.
 *
 * 🔴 KHÔNG còn Authorization Code ở bất kỳ đâu: sau khi Seller Approve trên TikTok, callback
 * của backend tự đổi code lấy token, tự lấy shop và tự lưu kết nối với đúng Account Name đã
 * nhập (tên được lưu kèm `state`). Đây là điều kiện TikTok App Review yêu cầu.
 */
export function LinkAccountDialog({ open, onClose }: LinkAccountDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { t: tv } = useTranslation('validation');
  const translateApiError = useApiError();
  const schema = useMemo(() => createStartTiktokAuthorizationSchema(tv), [tv]);

  const startAuthorization = useStartTiktokAuthorization();
  const [session, setSession] = useState<PodTiktokAuthorizeUrl | null>(null);
  const [copied, setCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<StartTiktokAuthorizationInput>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
  });

  // Mỗi lần mở lại dialog phải sạch: link cũ mang `state` đã hết hạn hoặc đã dùng.
  useEffect(() => {
    if (open) {
      reset(DEFAULTS);
      setSession(null);
      setCopied(false);
    }
  }, [open, reset]);

  const handleGenerate = async (values: StartTiktokAuthorizationInput) => {
    try {
      setSession(await startAuthorization.mutateAsync({ accountName: values.accountName }));
      setCopied(false);
    } catch (error) {
      toast.error(t('link.urlFailed'), { description: translateApiError(error) });
    }
  };

  const handleCopyUrl = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.authorizeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('link.copySuccess'));
    } catch {
      // Clipboard API cần ngữ cảnh bảo mật (HTTPS) và quyền — trên vài trình duyệt sẽ bị
      // chặn. Bôi đen sẵn nội dung để người dùng copy tay được ngay.
      urlInputRef.current?.select();
      toast.error(t('link.copyFailed'));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('link.title')} description={t('link.description')}>
      <div className="space-y-5">
        {/* Bước 1 — nhập tên kết nối rồi tạo Authorization URL */}
        <form onSubmit={handleSubmit(handleGenerate)} className="space-y-4">
          <p className="text-sm font-medium">{t('link.step1')}</p>

          <div className="space-y-2">
            <Label htmlFor="accountName">
              {t('link.accountName')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountName"
              placeholder={t('link.accountNamePlaceholder')}
              autoComplete="off"
              disabled={Boolean(session)}
              {...register('accountName')}
            />
            <FieldError message={errors.accountName?.message} />
            <p className="text-xs text-muted-foreground">{t('link.accountNameHint')}</p>
          </div>

          {!session && (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={startAuthorization.isPending}
              >
                {t('common:action.cancel')}
              </Button>
              <Button type="submit" disabled={startAuthorization.isPending}>
                {startAuthorization.isPending && <Loader2 className="animate-spin" />}
                {t('link.generateUrl')}
              </Button>
            </div>
          )}
        </form>

        {/* Bước 2 — copy Authorization URL và dán vào TikTok Partner */}
        {session && (
          <div className="space-y-4 border-t pt-4">
            <p className="text-sm font-medium">{t('link.step2')}</p>

            <div className="space-y-2">
              <Label htmlFor="authorizeUrl">{t('link.authorizationUrl')}</Label>
              <Input
                id="authorizeUrl"
                ref={urlInputRef}
                readOnly
                value={session.authorizeUrl}
                // Bấm vào là bôi đen toàn bộ — thao tác quen thuộc khi cần copy tay.
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
                className="break-all font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void handleCopyUrl()}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t('link.copyUrl')}
              </Button>
              <Button asChild type="button" variant="outline">
                <a href={session.authorizeUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  {t('link.openAuthorize')}
                </a>
              </Button>
            </div>

            <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              {t('link.autoNotice')}
            </p>

            <div className="flex justify-end pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common:action.close')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
