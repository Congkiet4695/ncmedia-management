'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Play, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  useFlashSaleAutoConfig,
  useRunFlashSaleAutoNow,
  useUpdateFlashSaleAutoConfig,
} from '@/features/pod-flash-sale/hooks';
import { browserTimeZone, listTimeZones } from '@/features/pod-flash-sale/timezone';
import {
  FLASH_SALE_AUTO_DURATION_MODES,
  FLASH_SALE_AUTO_DURATIONS,
  type FlashSaleAutoDuration,
  type FlashSaleAutoDurationMode,
  type PodFlashSaleAutoRunResult,
} from '@/features/pod-flash-sale/types';

const RUN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function FlashSaleAutoSettingsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.flashsale.auto.config" message={t('flashSale.auto.settings.noPermission')}>
      <AutoSettingsView />
    </RequirePermission>
  );
}

/**
 * **Settings → Auto Flash Sale Scheduler** — Admin chọn giờ chạy mỗi ngày + múi giờ + Khoảng thời gian
 * của đợt sinh tự động (1/2/3 ngày lịch, kết thúc 23:59:59 theo múi giờ của CHÍNH đợt sale).
 *
 * 🔴 Không có giờ mặc định cứng: cấu hình chưa lưu thì ô giờ để trống, Admin phải chọn. Múi giờ
 * gợi ý là múi giờ của trình duyệt, không phải của server.
 */
function AutoSettingsView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();

  const config = useFlashSaleAutoConfig();
  const save = useUpdateFlashSaleAutoConfig();
  const runNow = useRunFlashSaleAutoNow();

  const [enabled, setEnabled] = useState(false);
  const [runTime, setRunTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [durationMode, setDurationMode] = useState<FlashSaleAutoDurationMode>('CALENDAR_DAYS');
  const [duration, setDuration] = useState<FlashSaleAutoDuration>('THREE_DAYS');

  useEffect(() => {
    if (!config.data) return;
    setEnabled(config.data.enabled);
    setRunTime(config.data.runTime ?? '');
    setTimezone(config.data.timezone ?? browserTimeZone());
    setDurationMode(config.data.durationMode);
    setDuration(config.data.duration);
  }, [config.data]);

  const timeZoneOptions = useMemo(() => listTimeZones().map((zone) => ({ value: zone, label: zone })), []);
  const runTimeValid = RUN_TIME_PATTERN.test(runTime);

  const onError = (error: unknown): void => {
    toast.error(translateApiError(error));
  };

  const summaryText = (result: PodFlashSaleAutoRunResult): string =>
    t('flashSale.auto.settings.summary', {
      checked: result.checked,
      created: result.created,
      transferred: result.transferred,
      inProgress: result.inProgress,
      skipped: result.skipped,
      failed: result.failed,
    });

  if (config.isLoading || !config.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = config.data;
  const last = data.lastRunSummary;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
          {t('common:action.back')}
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{t('flashSale.auto.settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('flashSale.auto.settings.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={enabled} onChange={() => setEnabled((value) => !value)} />
            {t('flashSale.auto.settings.enabled')}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="auto-run-time">{t('flashSale.auto.settings.runTime')}</Label>
              <Input
                id="auto-run-time"
                type="time"
                value={runTime}
                onChange={(event) => setRunTime(event.target.value)}
                aria-invalid={runTime !== '' && !runTimeValid}
              />
              <p className="text-xs text-muted-foreground">{t('flashSale.auto.settings.runTimeHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-timezone">{t('flashSale.auto.settings.timezone')}</Label>
              <Combobox id="auto-timezone" value={timezone} onChange={setTimezone} options={timeZoneOptions} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-duration-mode">{t('flashSale.auto.settings.durationMode')}</Label>
              <Combobox
                id="auto-duration-mode"
                value={durationMode}
                onChange={(value) => setDurationMode(value as FlashSaleAutoDurationMode)}
                options={FLASH_SALE_AUTO_DURATION_MODES.map((mode) => ({
                  value: mode,
                  label: t(`flashSale.auto.settings.durationModes.${mode}`),
                }))}
              />
            </div>
            {durationMode === 'CALENDAR_DAYS' && (
              <div className="space-y-1.5">
                <Label htmlFor="auto-duration">{t('flashSale.auto.settings.duration')}</Label>
                <Combobox
                  id="auto-duration"
                  value={duration}
                  onChange={(value) => setDuration(value as FlashSaleAutoDuration)}
                  options={FLASH_SALE_AUTO_DURATIONS.map((value) => ({
                    value,
                    label: t(`flashSale.auto.settings.durations.${value}`),
                  }))}
                />
                <p className="text-xs text-muted-foreground">{t('flashSale.auto.settings.durationHint')}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!runTimeValid || !timezone || save.isPending}
              onClick={() => {
                void save
                  .mutateAsync({ enabled, runTime, timezone, durationMode, duration })
                  .then(() => toast.success(t('flashSale.auto.settings.saved')))
                  .catch(onError);
              }}
            >
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t('flashSale.auto.settings.save')}
            </Button>
            <Button
              variant="outline"
              disabled={runNow.isPending}
              onClick={() => {
                if (!window.confirm(t('flashSale.auto.settings.runNowConfirm'))) return;
                void runNow
                  .mutateAsync()
                  .then((result) =>
                    toast.success(
                      t('flashSale.auto.settings.runDone', {
                        created: result.created,
                        transferred: result.transferred,
                        failed: result.failed,
                      }),
                    ),
                  )
                  .catch(onError);
              }}
            >
              {runNow.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {t('flashSale.auto.settings.runNow')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('flashSale.auto.settings.lastResult')}</h2>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">{t('flashSale.auto.settings.lastRun')}</dt>
            <dd>
              {data.lastRunAt
                ? `${formatDateTime(data.lastRunAt)} · ${data.lastRunTrigger ? t(`flashSale.auto.trigger.${data.lastRunTrigger}`) : ''}`
                : t('flashSale.auto.settings.never')}
            </dd>
            <dt className="text-muted-foreground">{t('flashSale.auto.settings.nextRun')}</dt>
            <dd>{data.nextRunAt ? formatDateTime(data.nextRunAt) : t('flashSale.auto.settings.disabled')}</dd>
            <dt className="text-muted-foreground">{t('flashSale.auto.settings.lastResult')}</dt>
            <dd>
              {last
                ? `${t(`flashSale.auto.runStatus.${last.status}`)} — ${summaryText(last)}`
                : t('flashSale.auto.settings.never')}
            </dd>
          </dl>

          {last && last.nodes.length > 0 && (
            <ul className="space-y-1 border-t pt-3">
              {last.nodes.map((node) => (
                <li key={node.flashSaleId} className="flex flex-wrap gap-x-2">
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => router.push(`/dashboard/pod/flash-sales/${node.flashSaleId}`)}
                  >
                    {node.name}
                  </button>
                  <span className={node.action === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}>
                    {t(`flashSale.auto.action.${node.action}`)}
                    {node.message ? ` — ${node.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t pt-3">
            <p className="font-medium">{t('flashSale.auto.settings.rulesTitle')}</p>
            <p className="text-muted-foreground">{t('flashSale.auto.settings.rules', data.rules)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
