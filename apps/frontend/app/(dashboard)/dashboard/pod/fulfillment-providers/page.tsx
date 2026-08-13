'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Power,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
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
import { ProviderFormDialog } from '@/features/fulfillment/components/provider-form-dialog';
import {
  useFulfillmentProviderActions,
  useFulfillmentProviders,
} from '@/features/fulfillment/hooks/use-fulfillment';
import type {
  FulfillmentProviderAccount,
  TestConnectionResult,
} from '@/features/fulfillment/types';

export default function FulfillmentProvidersPage() {
  const { t } = useTranslation('fulfillment');
  return (
    <RequirePermission permission="fulfillment.config" message={t('provider.noPermission')}>
      <ProvidersView />
    </RequirePermission>
  );
}

function ProvidersView() {
  const { t } = useTranslation(['fulfillment', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();

  const query = useFulfillmentProviders();
  const actions = useFulfillmentProviderActions();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FulfillmentProviderAccount | null>(null);
  const [deleting, setDeleting] = useState<FulfillmentProviderAccount | null>(null);
  // Kết quả Test Connection giữ theo từng dòng — bấm thử nhà cung cấp này không được
  // xoá kết quả của nhà cung cấp khác.
  const [testResults, setTestResults] = useState<Record<string, TestConnectionResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  const providers = query.data ?? [];

  const handleCreate = async (input: Parameters<typeof actions.create.mutateAsync>[0]) => {
    try {
      const created = await actions.create.mutateAsync(input);
      toast.success(t('provider.createSuccess'), { description: created.name });
      setFormOpen(false);
      // URL webhook chứa secret và CHỈ trả về một lần — hiện ngay để người dùng lưu lại.
      if (created.webhookUrl) setWebhookUrl(created.webhookUrl);
    } catch (error) {
      toast.error(t('provider.createSuccess'), { description: translateApiError(error) });
    }
  };

  const handleUpdate = async (
    id: string,
    input: Parameters<typeof actions.update.mutateAsync>[0]['input'],
  ) => {
    try {
      await actions.update.mutateAsync({ id, input });
      toast.success(t('provider.updateSuccess'));
      setFormOpen(false);
      setEditing(null);
    } catch (error) {
      toast.error(t('provider.updateSuccess'), { description: translateApiError(error) });
    }
  };

  const handleToggleActive = async (provider: FulfillmentProviderAccount) => {
    try {
      await actions.update.mutateAsync({ id: provider.id, input: { isActive: !provider.isActive } });
      toast.success(t('provider.updateSuccess'), { description: provider.name });
    } catch (error) {
      toast.error(t('provider.updateSuccess'), { description: translateApiError(error) });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const result = await actions.remove.mutateAsync(deleting.id);
      toast.success(t('provider.deleteSuccess'), {
        description: t('assign.cleared') + ` (${result.unlinkedTiktokAccounts})`,
      });
      setDeleting(null);
    } catch (error) {
      toast.error(t('provider.deleteSuccess'), { description: translateApiError(error) });
    }
  };

  const handleTest = async (provider: FulfillmentProviderAccount) => {
    setTestingId(provider.id);
    try {
      const result = await actions.testConnection.mutateAsync(provider.id);
      setTestResults((prev) => ({ ...prev, [provider.id]: result }));
      if (result.connected) toast.success(t('provider.connected'), { description: provider.name });
      // Lỗi từ nhà cung cấp hiện NGUYÊN VĂN ở dòng tương ứng, không rút gọn.
      else toast.error(t('provider.connectionFailed'), { description: result.message });
    } catch (error) {
      toast.error(t('provider.connectionFailed'), { description: translateApiError(error) });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('provider.pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('provider.pageSubtitle')}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          {t('provider.add')}
        </Button>
      </div>

      <Card>
        <CardHeader />
        <CardContent>
          {query.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {translateApiError(query.error)}
            </p>
          ) : providers.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t('provider.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('provider.type')}</TableHead>
                    <TableHead>{t('provider.displayName')}</TableHead>
                    <TableHead>{t('provider.apiKey')}</TableHead>
                    <TableHead>{t('provider.status')}</TableHead>
                    <TableHead className="text-right">{t('provider.linkedAccounts')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('provider.created')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('provider.updated')}</TableHead>
                    <TableHead className="text-right">{t('common:table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((provider) => {
                    const result = testResults[provider.id];
                    return (
                      <TableRow key={provider.id}>
                        <TableCell>
                          <Badge variant="muted">{provider.provider}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {provider.name}
                          {result && (
                            <p
                              className={
                                result.connected
                                  ? 'mt-1 text-xs text-emerald-600'
                                  : 'mt-1 max-w-[280px] break-words text-xs text-destructive'
                              }
                            >
                              {result.connected ? t('provider.connected') : result.message}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {provider.apiKeyHint ? `••••••••${provider.apiKeyHint}` : '••••••••'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={provider.isActive ? 'success' : 'muted'}>
                            {t(`provider.statusValue.${provider.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {provider.linkedTiktokAccounts}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(provider.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(provider.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('provider.testConnection')}
                              title={t('provider.testConnection')}
                              disabled={testingId === provider.id}
                              onClick={() => void handleTest(provider)}
                            >
                              {testingId === provider.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : result?.connected ? (
                                <CheckCircle2 className="size-4 text-emerald-600" />
                              ) : result ? (
                                <XCircle className="size-4 text-destructive" />
                              ) : (
                                <Plug className="size-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                provider.isActive ? t('provider.deactivate') : t('provider.activate')
                              }
                              title={
                                provider.isActive ? t('provider.deactivate') : t('provider.activate')
                              }
                              onClick={() => void handleToggleActive(provider)}
                            >
                              <Power
                                className={
                                  provider.isActive ? 'size-4 text-emerald-600' : 'size-4'
                                }
                              />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('common:action.edit')}
                              onClick={() => {
                                setEditing(provider);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('common:action.delete')}
                              onClick={() => setDeleting(provider)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProviderFormDialog
        open={formOpen}
        provider={editing}
        submitting={actions.create.isPending || actions.update.isPending}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onCreate={(input) => void handleCreate(input)}
        onUpdate={(input) => editing && void handleUpdate(editing.id, input)}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('provider.deleteTitle')}
        description={t('provider.deleteDescription', {
          name: deleting?.name ?? '',
          count: deleting?.linkedTiktokAccounts ?? 0,
        })}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)}>
            {t('common:action.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={actions.remove.isPending}
            onClick={() => void handleDelete()}
          >
            {actions.remove.isPending && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.delete')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(webhookUrl)}
        onClose={() => setWebhookUrl(null)}
        title={t('provider.webhookUrlOnce')}
      >
        <p className="break-all rounded bg-muted p-3 font-mono text-xs">{webhookUrl}</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setWebhookUrl(null)}>{t('common:action.close')}</Button>
        </div>
      </Modal>
    </div>
  );
}
