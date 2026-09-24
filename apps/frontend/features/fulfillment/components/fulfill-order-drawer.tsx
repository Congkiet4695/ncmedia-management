'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronRight,
  Factory,
  ImageOff,
  Loader2,
  Package,
  RotateCw,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Drawer, DrawerSection } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ImageLightbox } from '@/features/pod-tiktok/components/image-lightbox';
import { usePodOrder } from '@/features/pod-tiktok/hooks/use-pod-orders';
import { POD_DESIGN_PLACEMENTS } from '@/features/pod-tiktok/order-types';
import { cn } from '@/lib/utils';
import {
  useFulfillmentActions,
  useFulfillmentErrors,
  useFulfillmentHistory,
  useFulfillmentState,
  useShippingLabelActions,
} from '../hooks/use-fulfillment';
import {
  canSubmitFulfillment,
  SUBMITTABLE_STATUSES,
  submitBlockers,
} from '../product-config';
import {
  FULFILL_FACILITIES,
  FULFILL_PREFERRED_CARRIERS,
  FULFILL_SHIPPING_METHODS,
  FULFILL_SPEED_TYPES,
  type FulfillPayload,
  type FulfillmentIssue,
  type FulfillmentIssueSection,
  type FulfillmentOrder,
  type FulfillmentStatus,
} from '../types';
import { ProductConfigPanel } from './product-config-panel';

interface FulfillOrderDrawerProps {
  open: boolean;
  onClose: () => void;
  podOrderId: string;
}

/**
 * Trạng thái còn cho phép gửi (hoặc gửi lại).
 *
 * 🔴 Lấy từ `SUBMITTABLE_STATUSES` — CÙNG danh sách mà `submitBlockers()` dùng để quyết định
 * nút bật hay tắt. Khai lại ở đây một bản riêng là mở đường cho "nút biến mất nhưng hệ thống
 * vẫn coi là gửi được" (và ngược lại).
 */
const SUBMITTABLE: ReadonlySet<FulfillmentStatus> = new Set(SUBMITTABLE_STATUSES);
/** Trạng thái đang chạy ⇒ khoá mọi hành động. */
const BUSY_STATUS: ReadonlySet<FulfillmentStatus> = new Set(['SUBMITTING']);

const STATUS_VARIANT: Record<FulfillmentStatus, 'default' | 'muted' | 'destructive' | 'success'> = {
  DRAFT: 'muted',
  SUBMITTING: 'muted',
  SUBMITTED: 'default',
  IN_PRODUCTION: 'default',
  ON_HOLD: 'muted',
  SHIPPED: 'default',
  DELIVERED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
  FAILED: 'destructive',
  UNKNOWN: 'muted',
};

/** URL nhãn phải tải được từ phía xưởng in ⇒ chỉ nhận http(s). */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * **Fulfill đơn POD** — tấm trượt phải, một màn hình cho cả quy trình gửi sản xuất.
 *
 * ```
 *   Danh sách đơn ─ [Fulfill] ─▶ Drawer
 *     ├─ Thông tin đơn        (sản phẩm · Product ID · SKU · biến thể · số lượng · shop · tiền)
 *     ├─ Loại fulfill         (POD — Dropship chưa có nhà cung cấp nào trong hệ thống)
 *     ├─ Thiết lập Fulfill    (đơn vị · shipping · speed · facility · carrier · scan · nhãn · ghi chú)
 *     ├─ Cấu hình sản phẩm    (ánh xạ → provider SKU · production config · khai nhanh nếu thiếu)
 *     ├─ Cấu hình Design      (từng vị trí in: có file hay chưa, xem được file)
 *     └─ footer ghim          [Huỷ] [Đẩy sang Fulfill]
 *          ↓ submit
 *   POST /fulfillment/orders/{id}/fulfill → MangoTee Create Order
 *          ↓
 *   Kết quả NGAY TRONG DRAWER: mã đơn nhà cung cấp · trạng thái · giá vốn từng dòng · tổng
 *   (hoặc lỗi nhà cung cấp + nút Chạy lại, dùng đúng order_id cũ)
 * ```
 *
 * 🔴 Mọi lý do "chưa gửi được" do BACKEND quyết định (`readiness`), và hiện ngay tại khối cần
 * sửa nhờ `issue.section` — không dồn hết vào một toast chung chung.
 *
 * 🔴 Nút gửi chỉ bật khi `submitBlockers()` rỗng, và khi nó TẮT thì lý do hiện ngay cạnh nút
 * (không bắt người dùng đoán, cũng không phải đi dò từng khối). Đang gửi thì khoá nút, khoá
 * cả nút đóng drawer. Chống gửi trùng thật sự nằm ở backend (khoá phân tán · unique DB ·
 * `order_id` idempotency).
 */
export function FulfillOrderDrawer({ open, onClose, podOrderId }: FulfillOrderDrawerProps) {
  const { t } = useTranslation(['fulfillment', 'pod', 'common']);
  const translateApiError = useApiError();
  const { formatCurrency, formatDateTime } = useLocaleFormat();

  const stateQuery = useFulfillmentState(podOrderId, open);
  const state = stateQuery.data;
  const orderQuery = usePodOrder(open ? podOrderId : undefined);
  const actions = useFulfillmentActions(podOrderId);

  const [form, setForm] = useState<FulfillPayload>({});
  const [labelError, setLabelError] = useState<string | null>(null);
  /**
   * Ô nhãn vận chuyển.
   *
   * 🔴 Nhãn là DỮ LIỆU CỦA ĐƠN, không phải tuỳ chọn của một lần gửi: backend đọc nhãn đã lưu
   * để quyết định đơn có gửi được không (đơn bị TikTok che địa chỉ chỉ đi được theo nhãn).
   * Vì thế ô này lưu xuống database qua nút Lưu, và giá trị gốc luôn lấy từ `state`.
   */
  const [labelInput, setLabelInput] = useState('');
  const labelActions = useShippingLabelActions(podOrderId);
  /** Kết quả lần gửi vừa rồi — có giá trị ⇒ thân drawer chuyển sang màn kết quả. */
  const [result, setResult] = useState<FulfillmentOrder | null>(null);
  const [designOpen, setDesignOpen] = useState(true);
  /** Ảnh design đang xem phóng to. */
  const [preview, setPreview] = useState<string | null>(null);

  /**
   * Ánh xạ của từng dòng hàng — do BACKEND ghép và trả kèm trạng thái.
   *
   * 🔴 Trước đây màn hình tự tải một trang ánh xạ (200 dòng) rồi tự ghép theo
   * `Product ID + Seller SKU`. Hai chỗ cùng viết một luật là hai chỗ trôi khỏi nhau, và bản
   * của giao diện còn phụ thuộc việc ánh xạ có lọt vào trang đó hay không: tổ chức vượt 200
   * ánh xạ là màn hình báo "chưa ánh xạ" cho sản phẩm đã ánh xạ, người dùng lưu lại và đâm
   * vào ràng buộc UNIQUE. Giờ chỉ còn MỘT nguồn.
   */
  const mappingByItemId = useMemo(
    () => new Map((state?.items ?? []).map((entry) => [entry.podOrderItemId, entry.mapping])),
    [state?.items],
  );
  /** Lịch sử chỉ nạp khi người dùng thực sự mở — không tốn request cho mỗi lần mở drawer. */
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyQuery = useFulfillmentHistory(podOrderId, open && historyOpen);
  const errorsQuery = useFulfillmentErrors(podOrderId, open && historyOpen);

  // Mở lại là một lần gửi MỚI: không giữ lựa chọn và kết quả của lần trước.
  useEffect(() => {
    if (!open) return;
    setForm({});
    setLabelError(null);
    setResult(null);
  }, [open]);

  /**
   * Nhãn đã lưu → ô nhập. Chỉ chạy khi GIÁ TRỊ ĐÃ LƯU đổi (mở drawer, lấy nhãn xong, lưu
   * xong), nên không giẫm lên thứ người dùng đang gõ dở.
   */
  const savedLabelUrl = stateQuery.data?.shippingLabel?.labelUrl ?? '';
  useEffect(() => {
    setLabelInput(savedLabelUrl);
  }, [savedLabelUrl]);

  const order = orderQuery.data;
  const record = result ?? state?.fulfillment ?? null;
  const status = record?.status ?? 'DRAFT';
  const isRetry = status === 'FAILED';
  const mutation = isRetry ? actions.retry : actions.fulfill;
  const submitting = mutation.isPending;
  const locked = BUSY_STATUS.has(status);
  /**
   * 🔴 MỘT nguồn cho cả ba: trạng thái `disabled` của nút, dòng giải thích ngay cạnh nút, và
   * chốt chặn trong `submit()`. Điều kiện thật nằm ở backend (`canFulfill` + `issues`); đây
   * chỉ là cách đọc lại — không có phép kiểm nào của riêng giao diện.
   */
  const blockers = submitBlockers({ state, status, submitting: submitting || locked });
  const canSubmit = canSubmitFulfillment({ state, status, submitting: submitting || locked });

  /** Lỗi đã nhóm theo khối — backend gửi kèm `section`, giao diện không tự đoán. */
  const issuesBySection = useMemo(() => {
    const grouped = new Map<FulfillmentIssueSection, FulfillmentIssue[]>();
    for (const issue of state?.issues ?? []) {
      const list = grouped.get(issue.section) ?? [];
      list.push(issue);
      grouped.set(issue.section, list);
    }
    return grouped;
  }, [state?.issues]);
  const messagesOf = (section: FulfillmentIssueSection) =>
    (issuesBySection.get(section) ?? []).map((issue) => issue.message);

  const option = (value: string, label: string) => ({ value, label });

  const savedLabel = state?.shippingLabel ?? null;
  const labelBusy = labelActions.fetchFromTiktok.isPending || labelActions.save.isPending;
  const labelDirty = labelInput.trim() !== (savedLabel?.labelUrl ?? '');

  /** Lấy nhãn từ TikTok. Bấm lại KHÔNG tạo gói mới — backend tái dùng gói đã có. */
  const getTiktokLabel = async (): Promise<void> => {
    if (labelBusy) return;
    setLabelError(null);
    try {
      const label = await labelActions.fetchFromTiktok.mutateAsync();
      setLabelInput(label.labelUrl);
      toast.success(
        label.reusedPackage ? t('fulfill.label.reused') : t('fulfill.label.fetched'),
        label.trackingNumber
          ? { description: t('fulfill.label.tracking', { value: label.trackingNumber }) }
          : undefined,
      );
    } catch (error) {
      toast.error(t('fulfill.label.fetchFailed'), { description: translateApiError(error) });
    }
  };

  /** Lưu nhãn người dùng tự dán — PERSIST, vì điều kiện gửi đọc từ database. */
  const saveLabel = async (): Promise<void> => {
    const url = labelInput.trim();
    if (labelBusy) return;
    if (!url) {
      await labelActions.clear.mutateAsync().catch(() => undefined);
      return;
    }
    if (!isHttpUrl(url)) {
      setLabelError(t('fulfill.labelUrlInvalid'));
      return;
    }
    setLabelError(null);
    try {
      await labelActions.save.mutateAsync(url);
      toast.success(t('fulfill.label.saved'));
    } catch (error) {
      toast.error(t('fulfill.label.saveFailed'), { description: translateApiError(error) });
    }
  };

  /**
   * Chốt chặn bấm hai lần trong CÙNG một tick.
   *
   * `submitting` đến từ state của react-query nên nó chỉ đúng ở lần render kế; hai cú click
   * nhanh cùng đọc `submitting = false` và cùng gọi API. Backend đã có khoá phân tán +
   * idempotency nên không sinh đơn trùng, nhưng gửi thêm một request vô ích rồi hiện một lỗi
   * khó hiểu thì vẫn là lỗi giao diện.
   */
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current || submitting || !canSubmit) return;
    submittingRef.current = true;
    // Người dùng sửa ô nhãn mà chưa lưu ⇒ lưu trước rồi mới gửi: backend chỉ nhìn nhãn
    // trong database, nên gửi ngay sẽ dùng nhãn CŨ mà người dùng tưởng đã đổi.
    if (labelDirty) {
      await saveLabel();
      if (labelInput.trim() && !isHttpUrl(labelInput.trim())) {
        submittingRef.current = false;
        return;
      }
    }
    setLabelError(null);
    try {
      const payload: FulfillPayload = {
        ...(form.shippingMethod ? { shippingMethod: form.shippingMethod } : {}),
        ...(form.facility ? { facility: form.facility } : {}),
        ...(form.speedType ? { speedType: form.speedType } : {}),
        ...(form.preferredCarrier ? { preferredCarrier: form.preferredCarrier } : {}),
        ...(form.isScanLabel ? { isScanLabel: true } : {}),
        // Nhãn KHÔNG đi trong body nữa: backend đọc nhãn ĐÃ LƯU của đơn (xem
        // `MangoFulfillmentService`). Gửi kèm một giá trị thứ hai chỉ tạo ra hai nguồn sự thật.

        ...(form.note?.trim() ? { note: form.note.trim() } : {}),
      };
      const created = await mutation.mutateAsync(payload);
      setResult(created);
      toast.success(t('fulfill.succeeded'));
    } catch (error) {
      // Chi tiết lỗi vẫn nằm trong drawer (khối "Kết quả") — toast chỉ là tín hiệu nhanh.
      toast.error(t('fulfill.failed'), { description: translateApiError(error) });
      void stateQuery.refetch();
    } finally {
      submittingRef.current = false;
    }
  };

  const items = order?.items ?? [];
  const firstItem = items[0];

  return (
    <>
      <Drawer
        open={open}
        onClose={submitting ? () => undefined : onClose}
        title={t('fulfill.drawerTitle', { orderId: order?.tiktokOrderId ?? '' })}
        description={t('fulfill.subtitle')}
        headerExtra={
          <>
            <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
            {record?.providerStatus && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {record.providerStatus}
              </span>
            )}
            {state?.provider && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Factory className="size-3" />
                {state.provider.name}
              </span>
            )}
          </>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-[11px] text-muted-foreground">
                {result ? t('fulfill.resultHint') : t('fulfill.defaultsHint')}
              </p>
              {/* Nút tắt ⇒ nói thẳng vì sao, ngay tại chỗ người dùng đang nhìn. */}
              {!result && blockers.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-destructive">
                  {blockers.map((blocker, index) => (
                    <li key={index}>
                      {blocker.code === 'LOADING' && t('fulfill.blocked.loading')}
                      {blocker.code === 'BUSY' && t('fulfill.blocked.busy')}
                      {blocker.code === 'STATUS' &&
                        t('fulfill.blocked.status', { status: t(`status.${blocker.status}`) })}
                      {blocker.code === 'NOT_READY' &&
                        (blocker.issues.length > 0
                          ? t('fulfill.blocked.notReady', {
                              reasons: blocker.issues.map((issue) => issue.message).join(' · '),
                            })
                          : t('fulfill.blocked.notReadyUnknown'))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
                {result ? t('common:action.close') : t('common:action.cancel')}
              </Button>
              {/* Đã gửi thành công ⇒ KHÔNG còn nút gửi (chống sản xuất trùng ngay ở giao diện). */}
              {(!result || isRetry) && SUBMITTABLE.has(status) && (
                <Button size="sm" onClick={() => void submit()} disabled={!canSubmit || submitting}>
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isRetry ? (
                    <RotateCw className="size-4" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {isRetry ? t('fulfill.retry') : t('fulfill.submit')}
                </Button>
              )}
            </div>
          </div>
        }
      >
        {stateQuery.isLoading || orderQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loadingState')}
          </div>
        ) : stateQuery.isError ? (
          <p className="py-10 text-center text-sm text-destructive">
            {translateApiError(stateQuery.error)}
          </p>
        ) : (
          <div className="space-y-4">
            {/* ---------------------------------------------- Kết quả / lỗi lần gửi gần nhất */}
            {(result ?? (record && !SUBMITTABLE.has(status))) && record && (
              <FulfillResult record={record} />
            )}
            {record?.lastErrorMessage && status === 'FAILED' && (
              <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="size-4" />
                  {t('fulfill.providerRejected')}
                </p>
                {record.lastErrorCode && (
                  <p className="font-mono">{record.lastErrorCode}</p>
                )}
                <p>{record.lastErrorMessage}</p>
                <p className="text-[11px] opacity-80">{t('fulfill.retryHint')}</p>
              </div>
            )}

            {/* ---------------------------------------------------------- Thông tin đơn hàng */}
            <DrawerSection
              title={t('fulfill.section.order')}
              issues={[...messagesOf('ORDER'), ...messagesOf('ADDRESS')]}
            >
              <div className="flex gap-3">
                {firstItem?.productImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={firstItem.productImage}
                    alt=""
                    className="size-16 shrink-0 rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-muted">
                    <ImageOff className="size-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="line-clamp-2 font-medium leading-snug">
                    {firstItem?.productName ?? order?.tiktokOrderId}
                  </p>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                    <Field label={t('pod:product.productId')} value={firstItem?.productId} mono />
                    <Field
                      label={t('pod:product.sku')}
                      value={firstItem?.sellerSku ?? firstItem?.skuId}
                      mono
                    />
                    <Field label={t('pod:product.variant')} value={firstItem?.skuName} />
                    <Field label={t('pod:product.qty')} value={String(items.length)} />
                    <Field label={t('fulfill.shop')} value={order?.shop.connectionName} />
                    <Field
                      label={t('fulfill.orderAmount')}
                      value={
                        order?.totalAmount === null || order?.totalAmount === undefined
                          ? undefined
                          : formatCurrency(order.totalAmount, order.currency)
                      }
                    />
                  </dl>
                </div>
              </div>
              {/* PII người nhận KHÔNG được trả về giao diện; địa chỉ chỉ được backend xác thực. */}
              <p className="text-[11px] text-muted-foreground">{t('fulfill.addressCheckedHint')}</p>
              {/* 🔴 Nói rõ hai tình huống khác hẳn nhau, thay vì một câu "đã che" chung chung:
                  còn địa chỉ đã lưu ⇒ vẫn gửi bình thường; không còn ⇒ phải đi theo nhãn. */}
              {state?.recipientMasked && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {state.shippingMode === 'LABEL'
                    ? t('fulfill.maskedNeedsLabel')
                    : t('fulfill.maskedUsingSnapshot')}
                </p>
              )}
            </DrawerSection>

            {/* ------------------------------------------------------------- Loại fulfillment */}
            <DrawerSection title={t('fulfill.section.type')} issues={messagesOf('PROVIDER')}>
              <div className="flex gap-2">
                <Badge variant="default">POD</Badge>
                {/* Dropship chưa có nhà cung cấp nào trong hệ thống ⇒ nói thẳng, không dựng tab giả. */}
                <Badge variant="muted" title={t('fulfill.dropshipUnavailable')}>
                  Dropship
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{t('fulfill.dropshipUnavailable')}</p>
            </DrawerSection>

            {/* ----------------------------------------------------------- Thiết lập Fulfill */}
            {SUBMITTABLE.has(status) && !result && (
              <DrawerSection title={t('fulfill.section.config')} issues={messagesOf('SHIPPING')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t('fulfill.shippingMethodLabel')}</Label>
                    <Combobox
                      value={form.shippingMethod ?? ''}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          shippingMethod: (value || undefined) as FulfillPayload['shippingMethod'],
                        }))
                      }
                      options={[
                        option('', t('fulfill.useAccountDefault')),
                        ...FULFILL_SHIPPING_METHODS.map((value) =>
                          option(value, t(`fulfill.shippingMethod.${value}`)),
                        ),
                      ]}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>{t('fulfill.speedTypeLabel')}</Label>
                    <Combobox
                      value={form.speedType ?? ''}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          speedType: (value || undefined) as FulfillPayload['speedType'],
                        }))
                      }
                      options={[
                        option('', t('fulfill.none')),
                        ...FULFILL_SPEED_TYPES.map((value) =>
                          option(value, t(`fulfill.speedType.${value}`)),
                        ),
                      ]}
                    />
                    <p className="text-[11px] text-muted-foreground">{t('fulfill.speedTypeHint')}</p>
                  </div>

                  <div className="space-y-1">
                    <Label>{t('fulfill.facilityLabel')}</Label>
                    <Combobox
                      value={form.facility ?? ''}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          facility: (value || undefined) as FulfillPayload['facility'],
                        }))
                      }
                      options={[
                        option('', t('fulfill.useAccountDefault')),
                        ...FULFILL_FACILITIES.map((value) => option(value, value)),
                      ]}
                    />
                    <p className="text-[11px] text-muted-foreground">{t('fulfill.facilityHint')}</p>
                  </div>

                  <div className="space-y-1">
                    <Label>{t('fulfill.preferredCarrierLabel')}</Label>
                    <Combobox
                      value={form.preferredCarrier ?? ''}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          preferredCarrier: (value ||
                            undefined) as FulfillPayload['preferredCarrier'],
                        }))
                      }
                      options={[
                        option('', t('fulfill.none')),
                        ...FULFILL_PREFERRED_CARRIERS.map((value) =>
                          option(value, t(`fulfill.preferredCarrier.${value}`)),
                        ),
                      ]}
                    />
                  </div>
                </div>

                {/* ------------------------------------------------- Nhãn vận chuyển */}
                <div className="space-y-1">
                  <Label>{t('fulfill.labelUrlLabel')}</Label>
                  <Input
                    value={labelInput}
                    placeholder="https://…"
                    onChange={(event) => setLabelInput(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void getTiktokLabel()}
                      disabled={labelBusy}
                    >
                      {labelActions.fetchFromTiktok.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {labelActions.fetchFromTiktok.isPending
                        ? t('fulfill.label.fetching')
                        : t('fulfill.label.getFromTiktok')}
                    </Button>
                    {/* Chỉ hiện khi người dùng THỰC SỰ đổi nội dung ô — nhãn vừa lấy từ
                        TikTok đã được backend lưu sẵn, không cần bấm lưu lần nữa. */}
                    {labelDirty && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void saveLabel()}
                        disabled={labelBusy}
                      >
                        {labelActions.save.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        {t('fulfill.label.save')}
                      </Button>
                    )}
                  </div>
                  {savedLabel && !labelDirty && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" />
                      {savedLabel.source === 'TIKTOK'
                        ? t('fulfill.label.savedTiktok')
                        : t('fulfill.label.savedManual')}
                      {savedLabel.trackingNumber && (
                        <span className="text-muted-foreground">
                          {t('fulfill.label.tracking', { value: savedLabel.trackingNumber })}
                        </span>
                      )}
                      {savedLabel.shippingServiceName && (
                        <span className="text-muted-foreground">
                          · {savedLabel.shippingServiceName}
                        </span>
                      )}
                    </p>
                  )}
                  {labelError ? (
                    <p className="text-xs text-destructive">{labelError}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{t('fulfill.labelUrlHint')}</p>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.isScanLabel === true}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, isScanLabel: event.target.checked }))
                    }
                  />
                  {t('fulfill.scanLabel')}
                </label>

                <div className="space-y-1">
                  <Label>{t('fulfill.noteLabel')}</Label>
                  <textarea
                    value={form.note ?? ''}
                    onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                    rows={2}
                    maxLength={1000}
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    placeholder={t('fulfill.notePlaceholder')}
                  />
                </div>
              </DrawerSection>
            )}

            {/* --------------------------------------------------------- Cấu hình sản phẩm */}
            {/* 🔴 Mỗi dòng hàng MỘT khối cấu hình đầy đủ (sản phẩm nhà cung cấp · production
                config · màu/size hoặc SKU · artwork) — không còn wizard nhiều bước mở riêng. */}
            <DrawerSection title={t('fulfill.section.product')} issues={messagesOf('MAPPING')}>
              <div className="space-y-3">
                {items.map((item) => {
                  return (
                    <ProductConfigPanel
                      key={item.id}
                      item={item}
                      accountId={state?.provider?.id ?? order?.fulfillmentAccountId ?? null}
                      mapping={mappingByItemId.get(item.id) ?? null}
                      designs={item.designs}
                      issues={(issuesBySection.get('MAPPING') ?? [])
                        .filter((issue) => issue.podOrderItemId === item.id)
                        .map((issue) => issue.message)}
                      onSaved={() => {
                        // Trạng thái (ready/issues/ánh xạ) và đơn (design) cùng đến từ hai
                        // query này — không còn danh sách ánh xạ riêng để phải đồng bộ.
                        void stateQuery.refetch();
                        void orderQuery.refetch();
                      }}
                      onPreviewDesign={setPreview}
                    />
                  );
                })}
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('fulfill.noItems')}</p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('fulfill.mappingHint')}</p>
            </DrawerSection>

            {/* ------------------------------------------------------------ Cấu hình Design */}
            <DrawerSection
              title={t('fulfill.section.design')}
              issues={messagesOf('DESIGN')}
              action={
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setDesignOpen((prev) => !prev)}
                  aria-expanded={designOpen}
                >
                  {designOpen ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  {designOpen ? t('fulfill.collapse') : t('fulfill.expand')}
                </button>
              }
            >
              {designOpen &&
                items.map((item) => (
                  <div key={item.id} className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      <Package className="mr-1 inline size-3" />
                      {item.productName ?? item.sellerSku ?? t('fulfill.config.unnamedProduct')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {POD_DESIGN_PLACEMENTS.map((placement) => {
                        const design = item.designs.find((entry) => entry.placement === placement);
                        return (
                          <div key={placement} className="w-16 space-y-0.5 text-center">
                            {design ? (
                              <a
                                href={design.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={design.fileName}
                                className="block size-16 overflow-hidden rounded border"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={design.fileUrl}
                                  alt={placement}
                                  className="size-full object-cover"
                                  loading="lazy"
                                />
                              </a>
                            ) : (
                              <div
                                className={cn(
                                  'flex size-16 items-center justify-center rounded border border-dashed',
                                  'text-[10px] text-muted-foreground',
                                )}
                              >
                                {t('fulfill.designMissingShort')}
                              </div>
                            )}
                            <p className="truncate text-[10px] text-muted-foreground">{placement}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              <p className="text-[11px] text-muted-foreground">{t('fulfill.designHint')}</p>
            </DrawerSection>

            {/* ------------------------------------------------------------------- Lịch sử */}
            {record && (
              <DrawerSection
                title={t('history')}
                action={
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setHistoryOpen((prev) => !prev)}
                    aria-expanded={historyOpen}
                  >
                    {historyOpen ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                    {historyOpen ? t('fulfill.collapse') : t('fulfill.expand')}
                  </button>
                }
              >
                {record.submittedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('submittedAt')}: {formatDateTime(record.submittedAt)}
                  </p>
                )}
                {historyOpen &&
                  (historyQuery.isLoading ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      {t('loadingState')}
                    </div>
                  ) : (
                    <ul className="space-y-1 text-[11px]">
                      {(historyQuery.data ?? []).map((entry) => (
                        <li key={entry.id} className="flex gap-2">
                          <span className="shrink-0 text-muted-foreground">
                            {formatDateTime(entry.createdAt)}
                          </span>
                          <span className={cn('min-w-0', !entry.success && 'text-destructive')}>
                            <span className="font-medium">{entry.eventType}</span>
                            {entry.message && <span> — {entry.message}</span>}
                          </span>
                        </li>
                      ))}
                      {(historyQuery.data ?? []).length === 0 && (
                        <li className="text-muted-foreground">{t('historyEmpty')}</li>
                      )}
                      {/* Lỗi kỹ thuật gần nhất: mã nhà cung cấp + request id để đối soát. */}
                      {(errorsQuery.data ?? []).slice(0, 3).map((error) => (
                        <li key={error.id} className="flex gap-2 text-destructive">
                          <span className="shrink-0">{formatDateTime(error.createdAt)}</span>
                          <span className="min-w-0">
                            <span className="font-mono">{error.providerCode ?? error.errorClass}</span>
                            {error.message && <span> — {error.message}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ))}
              </DrawerSection>
            )}
          </div>
        )}
      </Drawer>

      {/* Xem phóng to file design đang gắn cho một vị trí in. */}
      <ImageLightbox open={Boolean(preview)} src={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0 opacity-70">{label}:</dt>
      <dd className={cn('truncate', mono && 'font-mono')}>{value || '—'}</dd>
    </div>
  );
}

/**
 * Kết quả: mã đơn nhà cung cấp, trạng thái và **giá vốn do nhà cung cấp báo về**.
 * Chưa có giá ⇒ nói rõ "đang chờ báo giá", không hiện 0.
 */
function FulfillResult({ record }: { record: FulfillmentOrder }) {
  const { t } = useTranslation('fulfillment');
  const { formatCurrency } = useLocaleFormat();
  const money = (value: number | null) =>
    value === null ? '—' : formatCurrency(value, record.currency);

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
        <CheckCircle2 className="size-4" />
        {t('fulfill.succeeded')}
      </div>

      <dl className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        <Field label={t('providerOrderId')} value={record.providerOrderId} mono />
        <Field label={t('externalOrderId')} value={record.externalOrderId} mono />
        <Field label={t('fulfill.statusLabel')} value={t(`status.${record.status}`)} />
        <Field label={t('fulfill.shippingMethodLabel')} value={record.shippingMethod} />
      </dl>

      <div className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-2 py-1.5 text-xs font-medium">
          <span>{t('fulfill.baseCost')}</span>
          {record.baseCostPending && (
            <Badge variant="warning">{t('fulfill.baseCostPending')}</Badge>
          )}
        </div>
        <ul className="divide-y text-xs">
          {record.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="min-w-0 truncate">
                <span className="font-mono">{item.providerSku}</span>
                {(item.color || item.size) && (
                  <span className="ml-1 text-muted-foreground">
                    {[item.color, item.size].filter(Boolean).join(' · ')}
                  </span>
                )}
                <span className="ml-1 text-muted-foreground">× {item.quantity}</span>
              </span>
              <span className="tabular-nums">
                {item.baseCost === null ? t('fulfill.baseCostWaiting') : money(item.baseCost)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="space-y-0.5 border-t px-2 py-1.5 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('fulfill.subtotal')}</dt>
            <dd className="tabular-nums">{money(record.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('fulfill.shippingFee')}</dt>
            <dd className="tabular-nums">{money(record.shippingFee)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>{t('fulfill.total')}</dt>
            <dd className="tabular-nums">{money(record.total)}</dd>
          </div>
        </dl>
      </div>

      {record.baseCostPending && (
        <p className="text-[11px] text-muted-foreground">{t('fulfill.baseCostPendingHint')}</p>
      )}
    </div>
  );
}
