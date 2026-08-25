'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eraser,
  Eye,
  FileUp,
  ImageOff,
  Loader2,
  Pencil,
  Rocket,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
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
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { JobProgressBar } from '@/features/pod-listing/components/job-progress-bar';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import {
  SessionConfigForm,
  type SessionConfigValue,
} from '@/features/pod-listing-session/components/session-config-form';
import { SessionPreviewDialog } from '@/features/pod-listing-session/components/session-preview-dialog';
import { SessionProductDialog } from '@/features/pod-listing-session/components/session-product-dialog';
import {
  useDeleteSessionProducts,
  useImportSessionProducts,
  useListingSession,
  useRemoveAllSessionProducts,
  usePreviewSessionProduct,
  useSessionProducts,
  useStartSessionListing,
  useUpdateSession,
  useValidateSession,
} from '@/features/pod-listing-session/hooks';
import { podListingSessionService } from '@/features/pod-listing-session/service';
import type {
  PodListingSessionDetail,
  PodSessionImportMode,
  PodSessionProduct,
} from '@/features/pod-listing-session/types';
import type { PreviewResult } from '@/features/pod-listing/types';

export default function ListingSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = useTranslation('pod');
  const { id } = use(params);
  return (
    <RequirePermission permission="pod.session.read" message={t('listing.common.noPermission')}>
      <SessionDetailView sessionId={id} />
    </RequirePermission>
  );
}

/**
 * **Một lượt đăng hàng** — toàn bộ quy trình nằm gọn trong màn hình này.
 *
 * ```
 *   Cấu hình  →  Import Product  →  Review (sửa / xem trước / xoá)  →  Start Listing
 * ```
 *
 * 🔴 Không có nút Publish. Start Listing chỉ tạo **Draft trên sàn** (`save_mode = AS_DRAFT`).
 */
function SessionDetailView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();
  const canWrite = hasPermission('pod.session.write');
  const canImport = hasPermission('pod.session.import');
  const canRun = hasPermission('pod.listing.run');

  const session = useListingSession(sessionId);
  const running = session.data?.status === 'LISTING';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<PodSessionProduct | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const products = useSessionProducts(
    sessionId,
    { page, limit: 50, search: search || undefined },
    running,
  );

  const importProducts = useImportSessionProducts();
  const removeProducts = useDeleteSessionProducts();
  const removeAll = useRemoveAllSessionProducts();
  const previewProduct = usePreviewSessionProduct();
  const validate = useValidateSession();
  const start = useStartSessionListing();

  const items = products.data?.items ?? [];
  const allSelected = items.length > 0 && selected.length === items.length;

  const act = async (action: Promise<unknown>, message: string): Promise<void> => {
    try {
      await action;
      toast.success(message);
    } catch (error) {
      toast.error(translateApiError(error));
    }
  };

  if (session.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session.data) {
    return <p className="text-sm text-destructive">{t('listing.sessions.notFound')}</p>;
  }

  const data = session.data;

  return (
    <div className="space-y-6">
      {/* --- Đầu trang --- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/pod/auto-listing">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
              <ListingStatusBadge
                status={data.status}
                label={t(`listing.sessions.status.${data.status}`)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {data.market} · {t('listing.sessions.productCount', { count: data.counts.TOTAL })}
              {data.sourceFile ? ` · ${data.sourceFile}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={validate.isPending || running}
            onClick={() =>
              void validate
                .mutateAsync(sessionId)
                .then((result) =>
                  result.ok
                    ? toast.success(
                        t('listing.sessions.validateOk', { count: result.readyProducts }),
                      )
                    : toast.warning(
                        result.issues[0]?.message ??
                          t('listing.sessions.validateFailed', {
                            count: result.products.filter((item) => !item.ok).length,
                          }),
                      ),
                )
                .catch((error: unknown) => toast.error(translateApiError(error)))
            }
          >
            {validate.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {t('listing.sessions.validate')}
          </Button>

          {canRun && (
            <Button
              disabled={start.isPending || running || data.counts.TOTAL === 0}
              onClick={() => {
                if (!window.confirm(t('listing.sessions.startConfirm', { name: data.name }))) return;
                void start
                  .mutateAsync({ id: sessionId })
                  .then((result) =>
                    toast.success(
                      t('listing.sessions.started', {
                        products: result.started,
                        targets: result.targets,
                      }),
                    ),
                  )
                  .catch((error: unknown) => toast.error(translateApiError(error)));
              }}
            >
              {start.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              {t('listing.sessions.start')}
            </Button>
          )}
        </div>
      </div>

      {/* --- Tiến độ lượt chạy --- */}
      {data.lastJob && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{data.lastJob.name}</p>
                <p className="text-xs text-muted-foreground">
                  {data.lastJob.startedAt ? formatDateTime(data.lastJob.startedAt) : '—'}
                  {data.lastJob.durationMs === null
                    ? ''
                    : ` · ${Math.round(data.lastJob.durationMs / 1000)}s`}
                </p>
              </div>
              <ListingStatusBadge
                status={data.lastJob.status}
                label={t(`listing.jobs.status.${data.lastJob.status}`)}
              />
            </div>
            <JobProgressBar job={data.lastJob} />
            {data.lastJob.lastError && (
              <p className="text-sm text-destructive">{data.lastJob.lastError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Cấu hình --- */}
      <SessionConfigCard
        session={data}
        open={configOpen}
        editable={canWrite && !running}
        onToggle={() => setConfigOpen((prev) => !prev)}
      />

      {/* --- Import --- */}
      {canImport && (
        <ImportCard
          disabled={running || importProducts.isPending}
          pending={importProducts.isPending}
          onImport={(file, mode) =>
            void importProducts
              .mutateAsync({ id: sessionId, file, mode })
              .then((result) => {
                toast.success(
                  t('listing.import.done', {
                    products: result.createdProducts,
                    images: result.createdImages,
                  }),
                  {
                    description:
                      result.errors.length > 0
                        ? t('listing.import.skipped', { count: result.errors.length })
                        : undefined,
                  },
                );
                setSelected([]);
              })
              .catch((error: unknown) =>
                toast.error(t('listing.import.failed'), { description: translateApiError(error) }),
              )
          }
        />
      )}

      {/* --- Draft Product --- */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {t('listing.products.heading', { count: products.data?.meta.total ?? 0 })}
            </h2>
            <div className="flex items-center gap-2">
              <Input
                value={search}
                placeholder={t('listing.products.searchPlaceholder')}
                className="w-[240px]"
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
              {canWrite && selected.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void act(
                      removeProducts
                        .mutateAsync({ id: sessionId, ids: selected })
                        .then(() => setSelected([])),
                      t('listing.products.deleted', { count: selected.length }),
                    )
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                  {t('listing.products.deleteSelected', { count: selected.length })}
                </Button>
              )}
              {canWrite && items.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running || removeAll.isPending}
                  onClick={() => {
                    if (!window.confirm(t('listing.products.removeAllConfirm'))) return;
                    void act(
                      removeAll.mutateAsync(sessionId).then(() => setSelected([])),
                      t('listing.products.removedAll'),
                    );
                  }}
                >
                  <Eraser className="size-4" />
                  {t('listing.products.removeAll')}
                </Button>
              )}
            </div>
          </div>

          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('listing.products.empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? [] : items.map((product) => product.id))
                      }
                    />
                  </TableHead>
                  <TableHead className="w-[64px]">{t('listing.products.thumbnail')}</TableHead>
                  <TableHead>{t('listing.products.title')}</TableHead>
                  <TableHead className="text-right">{t('listing.products.imageColumn')}</TableHead>
                  <TableHead>{t('listing.common.status')}</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.includes(product.id)}
                        onChange={() =>
                          setSelected((prev) =>
                            prev.includes(product.id)
                              ? prev.filter((id) => id !== product.id)
                              : [...prev, product.id],
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {/* Thumbnail = URL1, tức ảnh đầu tiên trong file import. */}
                      {product.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.images[0].imageUrl}
                          alt=""
                          className="size-10 rounded border object-cover"
                        />
                      ) : (
                        <span className="flex size-10 items-center justify-center rounded border bg-muted">
                          <ImageOff className="size-4 text-muted-foreground" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{product.title}</p>
                      {product.errorCount > 0 && (
                        <p className="text-xs text-destructive">{product.issues?.[0]?.message}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {product.images.length}
                    </TableCell>
                    <TableCell>
                      <ListingStatusBadge
                        status={product.status}
                        label={t(`listing.products.status.${product.status}`)}
                      />
                      {/* Id sản phẩm phía sàn: một dòng cho mỗi shop đã đăng. */}
                      {(product.results ?? [])
                        .filter((result) => result.remoteProductId)
                        .map((result) => (
                          <p key={result.shopId} className="text-xs text-muted-foreground">
                            {result.shop?.name ?? result.shopId}: {result.remoteProductId}
                          </p>
                        ))}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('listing.products.preview')}
                          disabled={previewProduct.isPending}
                          onClick={() =>
                            void previewProduct
                              .mutateAsync({ id: sessionId, productId: product.id })
                              .then(setPreview)
                              .catch((error: unknown) =>
                                toast.error(t('listing.products.previewFailed'), {
                                  description: translateApiError(error),
                                }),
                              )
                          }
                        >
                          <Eye className="size-4" />
                        </Button>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('common:action.edit')}
                            onClick={() => setEditing(product)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('common:action.delete')}
                            onClick={() =>
                              void act(
                                removeProducts.mutateAsync({ id: sessionId, ids: [product.id] }),
                                t('listing.products.deleted', { count: 1 }),
                              )
                            }
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {(products.data?.meta.totalPages ?? 0) > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((prev) => prev - 1)}
              >
                {t('common:action.previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {products.data?.meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (products.data?.meta.totalPages ?? 1)}
                onClick={() => setPage((prev) => prev + 1)}
              >
                {t('common:action.next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <SessionProductDialog
        sessionId={sessionId}
        product={editing}
        onClose={() => setEditing(null)}
      />
      <SessionPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** Cấu hình lượt đăng — thu gọn mặc định vì sau khi tạo xong người ta ít khi đụng tới. */
function SessionConfigCard({
  session,
  open,
  editable,
  onToggle,
}: {
  session: PodListingSessionDetail;
  open: boolean;
  editable: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const update = useUpdateSession();

  const initial = useMemo<SessionConfigValue>(
    () => ({
      name: session.name,
      market: session.market,
      shopIds: session.shops.map((link) => link.shopId),
      templates: {
        categoryTemplateId: pickTemplate(session, 'categoryTemplateId'),
        skuTemplateId: pickTemplate(session, 'skuTemplateId'),
        descriptionTemplateId: pickTemplate(session, 'descriptionTemplateId'),
        imageTemplateId: pickTemplate(session, 'imageTemplateId'),
        pricingStrategyId: pickTemplate(session, 'pricingStrategyId'),
      },
      note: session.note ?? '',
    }),
    [session],
  );

  const [config, setConfig] = useState<SessionConfigValue>(initial);
  // Server trả về bản mới (vd sau khi lưu, hoặc sau khi polling) ⇒ đồng bộ lại form.
  const syncedFrom = useRef(session.updatedAt);
  useEffect(() => {
    if (syncedFrom.current === session.updatedAt) return;
    syncedFrom.current = session.updatedAt;
    setConfig(initial);
  }, [initial, session.updatedAt]);

  const save = async (): Promise<void> => {
    try {
      await update.mutateAsync({
        id: session.id,
        payload: {
          name: config.name.trim(),
          market: config.market,
          shopIds: config.shopIds,
          templates: config.templates,
          note: config.note,
        },
      });
      toast.success(t('listing.sessions.saved'));
    } catch (error) {
      toast.error(t('listing.sessions.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{t('listing.sessions.config')}</h2>
            <p className="text-xs text-muted-foreground">
              {session.templates.length === 0
                ? t('listing.sessions.noTemplate')
                : session.templates
                    .map((row) => `${row.templateType}: ${row.templateName ?? '—'}`)
                    .join(' · ')}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onToggle}>
            {open ? t('common:action.close') : t('common:action.edit')}
          </Button>
        </div>

        {open && (
          <>
            <SessionConfigForm
              value={config}
              onChange={setConfig}
              disabled={!editable || update.isPending}
            />
            {editable && (
              <div className="flex justify-end border-t pt-3">
                <Button onClick={() => void save()} disabled={update.isPending}>
                  {update.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t('common:action.save')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Import Product — bước nạp nội dung vào lượt đăng đã cấu hình sẵn. */
function ImportCard({
  disabled,
  pending,
  onImport,
}: {
  disabled: boolean;
  pending: boolean;
  onImport: (file: File, mode: PodSessionImportMode) => void;
}) {
  const { t } = useTranslation('pod');
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<PodSessionImportMode>('APPEND');

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-6">
        <div className="space-y-1">
          <Label>{t('listing.import.mode')}</Label>
          <Combobox
            value={mode}
            className="w-[220px]"
            onChange={(value) => setMode(value as PodSessionImportMode)}
            options={[
              { value: 'APPEND', label: t('listing.import.modeAppend') },
              { value: 'REPLACE', label: t('listing.import.modeReplace') },
            ]}
          />
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onImport(file, mode);
          }}
        />

        <Button disabled={disabled} onClick={() => inputRef.current?.click()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          {t('listing.import.button')}
        </Button>

        <Button
          variant="outline"
          onClick={() => void podListingSessionService.downloadTemplate()}
        >
          <Download className="size-4" />
          {t('listing.import.template')}
        </Button>

        <div className="text-xs text-muted-foreground">
          <p>{t('listing.import.hint')}</p>
          <p className="font-mono">{t('listing.import.format')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Đọc id template của một loại từ bảng nối — mỗi loại đúng một dòng. */
function pickTemplate(
  session: PodListingSessionDetail,
  key: 'categoryTemplateId' | 'skuTemplateId' | 'descriptionTemplateId' | 'imageTemplateId' | 'pricingStrategyId',
): string | null {
  return session.templates.find((row) => row[key] !== null)?.[key] ?? null;
}
