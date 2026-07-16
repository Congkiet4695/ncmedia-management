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
  useUpdateTracking,
  useUpdateWarehouseNote,
} from '../hooks/use-orders';
import { FULFILLMENT_STATUSES, ORDER_STATUS_LABELS } from '../schemas/order.schema';
import type { Order, OrderStatus } from '../types';

/**
 * Panel Fulfillment (Requirement 5–8): Claim/Release + cập nhật Tracking / Warehouse Note / Status.
 * Chỉ hiện với người có quyền `order.fulfill`. Chỉ cho SỬA khi: là người đã Claim, hoặc ADMIN.
 * KHÔNG đụng field bán hàng (Customer/Items/Price/Address…) — readonly ở nơi khác.
 */
export function OrderFulfillmentPanel({ order }: { order: Order }) {
  const { user, hasPermission } = useAuth();
  const canFulfill = hasPermission('order.fulfill');
  const canClaim = hasPermission('order.claim');
  const isAdmin = hasPermission('order.release'); // admin-only permission

  const claimM = useClaimOrder();
  const releaseM = useReleaseOrder();
  const trackingM = useUpdateTracking();
  const statusM = useFulfillStatus();
  const whM = useUpdateWarehouseNote();

  const [tracking, setTracking] = useState(order.tracking ?? '');
  const [warehouseNote, setWarehouseNote] = useState(order.warehouseNote ?? '');
  const [warehouseNote2, setWarehouseNote2] = useState(order.warehouseNote2 ?? '');
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
            {/* Tracking */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="ful-tracking">Tracking Number</Label>
                <Input
                  id="ful-tracking"
                  value={tracking}
                  placeholder="Nhập mã tracking…"
                  onChange={(e) => setTracking(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                disabled={trackingM.isPending || tracking === (order.tracking ?? '')}
                onClick={() =>
                  run(
                    () => trackingM.mutateAsync({ id: order.id, payload: { tracking } }),
                    'Đã cập nhật Tracking.',
                    'Cập nhật Tracking thất bại',
                  )
                }
              >
                {trackingM.isPending ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                Lưu Tracking
              </Button>
            </div>

            {/* Warehouse notes */}
            <div className="space-y-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ful-wh">Warehouse Note</Label>
                  <Input id="ful-wh" value={warehouseNote} onChange={(e) => setWarehouseNote(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ful-wh2">Warehouse Note 2</Label>
                  <Input id="ful-wh2" value={warehouseNote2} onChange={(e) => setWarehouseNote2(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  disabled={
                    whM.isPending ||
                    (warehouseNote === (order.warehouseNote ?? '') &&
                      warehouseNote2 === (order.warehouseNote2 ?? ''))
                  }
                  onClick={() =>
                    run(
                      () =>
                        whM.mutateAsync({ id: order.id, payload: { warehouseNote, warehouseNote2 } }),
                      'Đã cập nhật Warehouse Note.',
                      'Cập nhật Warehouse Note thất bại',
                    )
                  }
                >
                  {whM.isPending && <Loader2 className="size-4 animate-spin" />}
                  Lưu Warehouse Note
                </Button>
              </div>
            </div>

            {/* Status */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="space-y-1.5 sm:w-48">
                <Label htmlFor="ful-status">Trạng thái</Label>
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
              SHIPPED yêu cầu đã có Tracking. Mỗi thay đổi được ghi Audit Log &amp; Timeline.
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
