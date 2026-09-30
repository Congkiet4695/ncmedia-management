'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save, Send, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useTelegramActions, useTelegramConfig } from '../hooks/use-notification';
import {
  TELEGRAM_BOT_TOKEN_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  type TelegramIntegrationStatus,
  type TelegramTestResult,
} from '../types';

const STATUS_VARIANT: Record<TelegramIntegrationStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  CONNECTED: 'success',
  UNTESTED: 'warning',
  DISCONNECTED: 'destructive',
  DISABLED: 'muted',
  NOT_CONFIGURED: 'muted',
};

/**
 * Cấu hình Telegram của tổ chức.
 *
 * 🔴 Bot Token KHÔNG BAO GIỜ được nạp vào form: backend chỉ trả bản che (`••••wxyz`). Ô token luôn
 * rỗng; để trống khi lưu ⇒ backend GIỮ token cũ. Nhờ vậy token không nằm trong state / DOM / cache
 * của trình duyệt sau khi đã lưu.
 */
export function TelegramConfigCard() {
  const { t } = useTranslation(['notification', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const query = useTelegramConfig();
  const actions = useTelegramActions();
  const config = query.data;

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testResult, setTestResult] = useState<TelegramTestResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Nạp giá trị đã lưu (trừ token) mỗi khi cấu hình trên server đổi.
  useEffect(() => {
    if (!config) return;
    setChatId(config.chatId ?? '');
    setEnabled(config.enabled);
  }, [config]);

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !config) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-6 text-sm text-destructive">
          <span>{translateApiError(query.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const trimmedToken = botToken.trim();
  const trimmedChat = chatId.trim();
  const tokenError =
    trimmedToken && !TELEGRAM_BOT_TOKEN_PATTERN.test(trimmedToken) ? t('telegram.error.tokenFormat') : null;
  const tokenRequired = !config.configured && !trimmedToken;
  const chatError = !trimmedChat
    ? t('telegram.error.chatRequired')
    : !TELEGRAM_CHAT_ID_PATTERN.test(trimmedChat)
      ? t('telegram.error.chatFormat')
      : null;
  const formInvalid = Boolean(tokenError || chatError || tokenRequired);
  const busy = actions.save.isPending || actions.test.isPending || actions.remove.isPending;

  const handleSave = async () => {
    try {
      await actions.save.mutateAsync({
        botToken: trimmedToken || undefined,
        chatId: trimmedChat,
        enabled,
      });
      setBotToken('');
      setTestResult(null);
      toast.success(t('telegram.saved'));
    } catch (error) {
      toast.error(t('telegram.saveFailed'), { description: translateApiError(error) });
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      // Thử đúng giá trị đang nhập (chưa cần lưu); ô trống ⇒ backend dùng giá trị đã lưu.
      const result = await actions.test.mutateAsync({
        botToken: trimmedToken || undefined,
        chatId: trimmedChat && trimmedChat !== config.chatId ? trimmedChat : undefined,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: translateApiError(error), errorCode: null, botUsername: null });
    }
  };

  const handleRemove = async () => {
    try {
      await actions.remove.mutateAsync();
      setBotToken('');
      setTestResult(null);
      setConfirmRemove(false);
      toast.success(t('telegram.removed'));
    } catch (error) {
      toast.error(t('telegram.removeFailed'), { description: translateApiError(error) });
    }
  };

  const canTest = !busy && !chatError && !tokenError && (config.configured || Boolean(trimmedToken));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{t('telegram.title')}</CardTitle>
          <CardDescription>{t('telegram.description')}</CardDescription>
        </div>
        <Badge variant={STATUS_VARIANT[config.status]}>{t(`telegram.status.${config.status}`)}</Badge>
      </CardHeader>

      <CardContent className="space-y-5">
        {!config.encryptionReady && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{t('telegram.encryptionMissing')}</span>
          </div>
        )}

        {config.status === 'DISCONNECTED' && config.lastErrorMessage && (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              {t('telegram.lastError', {
                at: config.lastDeliveryAt ? formatDateTime(config.lastDeliveryAt) : '—',
              })}{' '}
              {config.lastErrorMessage}
            </span>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="telegram-bot-token">{t('telegram.botToken')}</Label>
            <Input
              id="telegram-bot-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={botToken}
              placeholder={config.botTokenMasked ?? t('telegram.botTokenPlaceholder')}
              onChange={(event) => setBotToken(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(tokenError)}
            />
            <p className="text-xs text-muted-foreground">
              {config.configured ? t('telegram.botTokenKeepHint') : t('telegram.botTokenHint')}
              {config.botUsername ? ` · @${config.botUsername}` : ''}
            </p>
            {tokenError && <p className="text-xs text-destructive">{tokenError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="telegram-chat-id">{t('telegram.chatId')}</Label>
            <Input
              id="telegram-chat-id"
              value={chatId}
              placeholder="-1001234567890"
              onChange={(event) => setChatId(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(chatError && chatId)}
            />
            <p className="text-xs text-muted-foreground">{t('telegram.chatIdHint')}</p>
            {chatError && chatId && <p className="text-xs text-destructive">{chatError}</p>}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={busy} />
          {t('telegram.enable')}
        </label>

        {testResult && (
          <div
            className={
              testResult.success
                ? 'flex gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400'
                : 'flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'
            }
          >
            {testResult.success ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {testResult.success
                ? t('telegram.testSuccess', { bot: testResult.botUsername ? `@${testResult.botUsername}` : '' })
                : testResult.errorCode
                  ? `${t(`telegram.testError.${testResult.errorCode}`, { defaultValue: '' })} ${testResult.message}`.trim()
                  : testResult.message}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={busy || formInvalid}>
            {actions.save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('common:action.save')}
          </Button>
          <Button variant="outline" onClick={() => void handleTest()} disabled={!canTest}>
            {actions.test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t('telegram.sendTest')}
          </Button>
          {config.configured && (
            <Button
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
            >
              <Trash2 className="size-4" />
              {t('telegram.remove')}
            </Button>
          )}
        </div>
      </CardContent>

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t('telegram.removeTitle')}
        description={t('telegram.removeConfirm')}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmRemove(false)} disabled={actions.remove.isPending}>
              {t('common:action.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleRemove()} disabled={actions.remove.isPending}>
              {actions.remove.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('telegram.remove')}
            </Button>
          </>
        }
      />
    </Card>
  );
}
