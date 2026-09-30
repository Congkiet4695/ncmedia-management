'use client';

import { useState } from 'react';
import { AlertTriangle, Globe, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  usePlatformProviderActions,
  usePlatformProviders,
} from '@/features/fulfillment/hooks/use-fulfillment';

/**
 * **Super Admin → Nhà cung cấp fulfillment** — danh mục sản phẩm DÙNG CHUNG toàn nền tảng.
 *
 * ```
 *   Super Admin ── Sync ──▶ MangoTeePrints API ──▶ MỘT bản danh mục trong database
 *                                                        ↑
 *                     Organization A · B · C … đọc cùng bản đó khi khai ánh xạ / gửi đơn
 * ```
 *
 * 🔴 Vì sao không để mỗi tổ chức tự đồng bộ: danh mục là dữ liệu của NHÀ CUNG CẤP. Mỗi tổ
 * chức kéo một bản là nhân bản hàng trăm sản phẩm × hàng chục nghìn biến thể cho từng tổ
 * chức, và dữ liệu giữa họ lệch nhau tuỳ ai bấm Sync lúc nào. Đây đúng khuôn màn hình
 * **POD → TikTok Master Data** đã dùng cho danh mục/thương hiệu TikTok.
 *
 * 🔴 Màn hình KHÔNG hiển thị UUID: cột định danh là TÊN nhà cung cấp và tên tổ chức sở hữu.
 */
export default function PlatformFulfillmentProvidersPage() {
  const { t } = useTranslation('fulfillment');
  return (
    <RequirePermission permission="platform.fulfillment.read" message={t('platform.noPermission')}>
      <PlatformProvidersView />
    </RequirePermission>
  );
}

function PlatformProvidersView() {
  const { t } = useTranslation(['fulfillment', 'common']);
  const { formatDateTime, formatNumber } = useLocaleFormat();
  const translateApiError = useApiError();
  const providers = usePlatformProviders();
  const actions = usePlatformProviderActions();
  /** Id nhà cung cấp vừa bấm — chỉ để khoá nút trong lúc request "bắt đầu đồng bộ" đang đi. */
  const [startingId, setStartingId] = useState<string | null>(null);

  /**
   * Bắt đầu đồng bộ — backend chạy NỀN và trả về ngay. Trạng thái "đang đồng bộ" đọc từ DATABASE
   * (`lastSyncStatus = RUNNING`), nên tải lại trang hay mở ở máy khác vẫn thấy đúng; danh sách tự hỏi
   * lại tới khi lượt đó xong (SUCCESS / PARTIAL / FAILED).
   */
  const sync = async (id: string, name: string): Promise<void> => {
    if (startingId) return;
    setStartingId(id);
    try {
      await actions.syncCatalog.mutateAsync(id);
      toast.success(t('platform.syncStarted', { name }));
    } catch (error) {
      toast.error(t('platform.syncFailed', { name }), { description: translateApiError(error) });
    } finally {
      setStartingId(null);
    }
  };

  const toggleGlobal = async (id: string, isGlobal: boolean): Promise<void> => {
    try {
      await actions.setGlobal.mutateAsync({ id, isGlobal });
      toast.success(isGlobal ? t('platform.sharedOn') : t('platform.sharedOff'));
    } catch (error) {
      toast.error(t('platform.shareFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('platform.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('platform.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('platform.column.provider')}</TableHead>
                <TableHead>{t('platform.column.shared')}</TableHead>
                <TableHead className="text-right">{t('platform.column.products')}</TableHead>
                <TableHead className="text-right">{t('platform.column.variants')}</TableHead>
                <TableHead className="text-right">{t('platform.column.colors')}</TableHead>
                <TableHead className="text-right">{t('platform.column.sizes')}</TableHead>
                <TableHead>{t('platform.column.lastSynced')}</TableHead>
                <TableHead>{t('platform.column.lastResult')}</TableHead>
                <TableHead className="text-right">{t('platform.column.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline size-4 animate-spin" />
                    {t('common:state.loading')}
                  </TableCell>
                </TableRow>
              )}

              {!providers.isLoading && (providers.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    {t('platform.empty')}
                  </TableCell>
                </TableRow>
              )}

              {(providers.data ?? []).map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="font-medium">{provider.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {provider.provider}
                        {provider.ownerOrganizationName
                          ? ` · ${t('platform.owner', { name: provider.ownerOrganizationName })}`
                          : ''}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={provider.isGlobal}
                        disabled={actions.setGlobal.isPending}
                        onChange={(event) => void toggleGlobal(provider.id, event.target.checked)}
                      />
                      {provider.isGlobal ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <Globe className="size-3.5" />
                          {t('platform.sharedYes')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('platform.sharedNo')}</span>
                      )}
                    </label>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(provider.products)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(provider.variants)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(provider.colors)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatNumber(provider.sizes)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {provider.lastSyncedAt ? formatDateTime(provider.lastSyncedAt) : '—'}
                  </TableCell>
                  <TableCell className="max-w-[260px] text-xs">
                    {provider.lastSyncStatus ? (
                      <div className="space-y-0.5">
                        <Badge
                          variant={
                            provider.lastSyncStatus === 'SUCCESS'
                              ? 'success'
                              : provider.lastSyncStatus === 'FAILED' ||
                                  provider.lastSyncStatus === 'INTERRUPTED'
                                ? 'destructive'
                                : provider.lastSyncStatus === 'PARTIAL'
                                  ? 'warning'
                                  : 'muted'
                          }
                        >
                          {provider.lastSyncStatus === 'RUNNING' && (
                            <Loader2 className="mr-1 size-3 animate-spin" />
                          )}
                          {t(`platform.status.${provider.lastSyncStatus}`, {
                            defaultValue: provider.lastSyncStatus,
                          })}
                        </Badge>
                        {provider.lastSyncStatus === 'PARTIAL' && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            {t('platform.syncIncomplete')}
                          </p>
                        )}
                        {provider.lastSyncMessage && provider.lastSyncStatus !== 'RUNNING' && (
                          <p className="flex gap-1 text-[11px] text-destructive">
                            <AlertTriangle className="mt-px size-3 shrink-0" />
                            {provider.lastSyncMessage}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {(() => {
                      const running =
                        startingId === provider.id || provider.lastSyncStatus === 'RUNNING';
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={running || startingId !== null}
                          onClick={() => void sync(provider.id, provider.name)}
                        >
                          {running ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          {running ? t('platform.syncing') : t('platform.sync')}
                        </Button>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">{t('platform.note')}</p>
    </div>
  );
}
