'use client';

import { useState } from 'react';
import { Loader2, PackageCheck, RotateCcw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { NativeSelect } from '@/components/ui/native-select';
import { useAuth } from '@/hooks/use-auth';
import { getApiErrorMessage } from '@/utils/http';
import {
  useClaimOrder,
  useFulfillStatus,
  useReleaseOrder,
  useUpdateItemFulfillment,
} from '../hooks/use-orders';
import {
  FULFILLMENT_STATUSES,
  ORDER_ITEM_STATUSES,
  ORDER_ITEM_STATUS_LABELS,
  ORDER_STATUS_LABELS,
} from '../schemas/order.schema';
import type { Order, OrderItem, OrderItemStatus, OrderStatus } from '../types';

/**
 * Panel Fulfillment: Claim/Release + cập nhật Tracking / Fulfillment Status theo TỪNG Item +
 * đổi trạng thái đơn. Chỉ hiện với người có quyền `order.fulfill`. Chỉ cho SỬA khi: là người đã
 * Claim, hoặc ADMIN. KHÔNG đụng field bán hàng (Items/Price/Address…) — readonly ở nơi khác.
 */
export function OrderFulfillmentPanel({ order }: { order: Order }) {
  const { user, hasPermission } = useAuth();
  const canFulfill = hasPermission('order.fulfill');
  const canClaim = hasPermission('order.claim');
  const isAdmin = hasPermission('order.release'); // admin-only permission

  const claimM = useClaimOrder();
  const releaseM = useReleaseOrder();
  const statusM = useFulfillStatus();

  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [statusNote, setStatusNote] = useState('');
  const [confirmClaim, setConfirmClaim] = useState(false);

  if (!canFulfill && !canClaim) return null;

  const mine = order.fulfilledById != null && order.fulfilledById === user?.id;
  const canEdit = canFulfill && (isAdmin || (order.isClaimed && mine));

  const run = async (fn: () => Promise<unknown>, ok: string, err: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(err, { description: getApiErrorMessage(e) });
    }
  };

  const onClaim = async () => {
    await run(() => claimM.mutateAsync(order.id), 'Bạn đã nhận xử lý đơn hàng.', 'Không thể nhận xử lý');
    setConfirmClaim(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Fulfillment</CardTitle>
            <CardDescription>
              {order.isClaimed
                ? `Đang xử lý bởi ${order.fulfilledByName ?? '—'}`
                : 'Chưa có Fulfillment nhận xử lý.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!order.isClaimed && canClaim && (
              <Button size="sm" disabled={claimM.isPending} onClick={() => setConfirmClaim(true)}>
                {claimM.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PackageCheck className="size-4" />
                )}
                Nhận xử lý
              </Button>
            )}
            {order.isClaimed && isAdmin && (
              <Button
                size="sm"
                variant="outline"
                disabled={releaseM.isPending}
                onClick={() =>
                  run(() => releaseM.mutateAsync(order.id), 'Đã release đơn hàng.', 'Release thất bại')
                }
              >
                {releaseM.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Release
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {order.isClaimed && !mine && !isAdmin && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            Đơn đang được xử lý bởi {order.fulfilledByName ?? 'Fulfillment khác'}. Bạn không thể chỉnh sửa.
          </p>
        )}

        {canEdit && (
          <>
            {/* Tracking + Fulfillment Status theo TỪNG Item */}
            <div className="space-y-3">
              <Label className="text-sm">Tracking &amp; trạng thái theo sản phẩm</Label>
              {order.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Đơn không có sản phẩm.</p>
              ) : (
                <ul className="space-y-2">
                  {order.items.map((item) => (
                    <OrderItemFulfillmentRow key={item.id} orderId={order.id} item={item} run={run} />
                  ))}
                </ul>
              )}
            </div>

            {/* Status đơn */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="space-y-1.5 sm:w-48">
                <Label htmlFor="ful-status">Trạng thái đơn</Label>
                <NativeSelect
                  id="ful-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as OrderStatus)}
                >
                  {FULFILLMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ORDER_STATUS_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="ful-status-note">Ghi chú (tuỳ chọn)</Label>
                <Input id="ful-status-note" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
              </div>
              <Button
                variant="outline"
                disabled={statusM.isPending || status === order.status}
                onClick={() =>
                  run(
                    () =>
                      statusM.mutateAsync({
                        id: order.id,
                        payload: { status, note: statusNote || undefined },
                      }),
                    'Đã cập nhật trạng thái.',
                    'Cập nhật trạng thái thất bại',
                  )
                }
              >
                {statusM.isPending && <Loader2 className="size-4 animate-spin" />}
                Đổi trạng thái
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Mỗi thay đổi được ghi Audit Log &amp; Timeline.
            </p>
          </>
        )}
      </CardContent>

      <Modal
        open={confirmClaim}
        onClose={() => setConfirmClaim(false)}
        title="Nhận xử lý đơn hàng"
        description="Nếu nhận xử lý, các Fulfillment khác sẽ không thể chỉnh sửa đơn hàng này."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmClaim(false)} disabled={claimM.isPending}>
            Hủy
          </Button>
          <Button onClick={onClaim} disabled={claimM.isPending}>
            {claimM.isPending && <Loader2 className="animate-spin" />}
            Xác nhận nhận xử lý
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/** Một dòng chỉnh Tracking + Fulfillment Status cho 1 OrderItem. */
function OrderItemFulfillmentRow({
  orderId,
  item,
  run,
}: {
  orderId: string;
  item: OrderItem;
  run: (fn: () => Promise<unknown>, ok: string, err: string) => Promise<void>;
}) {
  const updateM = useUpdateItemFulfillment();
  const [tracking, setTracking] = useState(item.trackingNumber ?? '');
  const [status, setStatus] = useState<OrderItemStatus>(item.fulfillmentStatus);

  const dirty = tracking !== (item.trackingNumber ?? '') || status !== item.fulfillmentStatus;

  return (
    <li className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{item.productName}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`trk-${item.id}`} className="text-xs">
            Tracking Number
          </Label>
          <Input
            id={`trk-${item.id}`}
            value={tracking}
            placeholder="Nhập mã tracking…"
            onChange={(e) => setTracking(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:w-44">
          <Label htmlFor={`st-${item.id}`} className="text-xs">
            Fulfillment Status
          </Label>
          <NativeSelect
            id={`st-${item.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderItemStatus)}
          >
            {ORDER_ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_ITEM_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          disabled={updateM.isPending || !dirty}
          onClick={() =>
            run(
              () =>
                updateM.mutateAsync({
                  id: orderId,
                  itemId: item.id,
                  payload: { trackingNumber: tracking, fulfillmentStatus: status },
                }),
              'Đã cập nhật sản phẩm.',
              'Cập nhật thất bại',
            )
          }
        >
          {updateM.isPending ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
          Lưu
        </Button>
      </div>
    </li>
  );
}
