'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { formatUSD } from '@/lib/format';
import { getApiErrorMessage } from '@/utils/http';
import { RequirePermission } from '@/components/require-permission';
import { OrderForm } from '@/features/orders/components/order-form';
import { OrderFulfillmentPanel } from '@/features/orders/components/order-fulfillment-panel';
import { OrderNotesPanel } from '@/features/orders/components/order-notes-panel';
import { OrderStatusBadge } from '@/features/orders/components/order-status-badge';
import { OrderStatusDialog } from '@/features/orders/components/order-status-dialog';
import { OrderTimeline } from '@/features/orders/components/order-timeline';
import { useOrder, useUpdateOrder, useUpdateOrderStatus } from '@/features/orders/hooks/use-orders';
import { toUpdateOrderPayload } from '@/features/orders/utils/form-payload';
import type { OrderFormInput, OrderStatusInput } from '@/features/orders/schemas/order.schema';

export default function OrderDetailPage() {
  return (
    <RequirePermission permission="order.read" message="Bạn không có quyền truy cập Order.">
      <OrderDetailView />
    </RequirePermission>
  );
}

function OrderDetailView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { hasPermission } = useAuth();

  const orderQuery = useOrder(id);
  const updateMutation = useUpdateOrder();
  const statusMutation = useUpdateOrderStatus();
  const [statusOpen, setStatusOpen] = useState(false);

  const canUpdate = hasPermission('order.update');

  if (orderQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <p className="text-sm text-destructive">
          {getApiErrorMessage(orderQuery.error, 'Không tìm thấy Order')}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/orders">
            <ArrowLeft className="size-4" />
            Quay lại danh sách
          </Link>
        </Button>
      </div>
    );
  }

  const order = orderQuery.data;

  const defaultValues: Partial<OrderFormInput> = {
    accountId: order.account.id,
    orderNumber: order.orderNumber,
    shippingAddress: order.shippingAddress ?? '',
    currency: order.currency ?? '',
    orderedAt: order.orderedAt ? order.orderedAt.slice(0, 10) : '',
    items: order.items.map((i) => ({
      productName: i.productName,
      productLink: i.productLink ?? '',
      color: i.color ?? '',
      size: i.size ?? '',
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      trackingNumber: i.trackingNumber ?? '',
      fulfillmentStatus: i.fulfillmentStatus,
      image: i.image ?? '',
      remark: i.remark ?? '',
    })),
  };

  const onSubmit = async (values: OrderFormInput) => {
    try {
      await updateMutation.mutateAsync({ id, payload: toUpdateOrderPayload(values) });
      toast.success('Cập nhật Order thành công');
      router.push('/dashboard/orders');
    } catch (error) {
      toast.error('Cập nhật thất bại', { description: getApiErrorMessage(error) });
    }
  };

  const onChangeStatus = async (values: OrderStatusInput) => {
    try {
      await statusMutation.mutateAsync({
        id,
        payload: { status: values.status, note: values.note || undefined },
      });
      toast.success('Đã cập nhật trạng thái');
      setStatusOpen(false);
    } catch (error) {
      toast.error('Đổi trạng thái thất bại', { description: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard/orders">
          <ArrowLeft className="size-4" />
          Quay lại danh sách
        </Link>
      </Button>

      {/* Tổng quan đơn */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Order {order.orderNumber}</CardTitle>
              <CardDescription>
                {order.account.name}
                {order.account.platform?.name ? ` · ${order.account.platform.name}` : ''}
                {order.account.sellerName ? ` · Seller: ${order.account.sellerName}` : ''}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <OrderStatusBadge status={order.status} />
              {canUpdate && (
                <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>
                  <RefreshCw className="size-4" />
                  Đổi trạng thái
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Địa chỉ giao hàng" value={order.shippingAddress} />
          <Info label="Đơn vị tiền tệ" value={order.currency} />
          <Info label="Tổng số lượng" value={String(order.totalQuantity)} />
          <Info label="Tổng tiền hàng" value={formatUSD(order.totalAmount)} />
        </CardContent>
      </Card>

      {/* Ghi chú Seller / Warehouse (CRUD) */}
      <OrderNotesPanel orderId={order.id} notes={order.notes} />

      {/* Fulfillment workflow (claim / tracking theo item / status) */}
      <OrderFulfillmentPanel order={order} />

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lịch sử trạng thái</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderTimeline history={order.statusHistories} />
        </CardContent>
      </Card>

      {/* Chỉnh sửa đơn + sản phẩm */}
      {canUpdate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Chỉnh sửa Order</CardTitle>
            <CardDescription>Account chủ đơn không thể thay đổi.</CardDescription>
          </CardHeader>
          <CardContent>
            <OrderForm
              mode="edit"
              accounts={[{ id: order.account.id, name: order.account.name }]}
              accountDisabled
              submitting={updateMutation.isPending}
              defaultValues={defaultValues}
              onSubmit={onSubmit}
            />
          </CardContent>
        </Card>
      )}

      <OrderStatusDialog
        open={statusOpen}
        current={order.status}
        submitting={statusMutation.isPending}
        onClose={() => setStatusOpen(false)}
        onSubmit={onChangeStatus}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap break-words">{value?.trim() ? value : '—'}</p>
    </div>
  );
}
