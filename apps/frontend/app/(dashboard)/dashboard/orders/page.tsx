'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/hooks/use-auth';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { getApiErrorMessage } from '@/utils/http';
import { RequirePermission } from '@/components/require-permission';
import { usePlatforms } from '@/features/accounts/hooks/use-accounts';
import { OrderFilter } from '@/features/orders/components/order-filter';
import { OrderTable } from '@/features/orders/components/order-table';
import {
  useClaimOrder,
  useDeleteOrder,
  useOrderAccounts,
  useOrders,
  useOrderSellers,
  useReleaseOrder,
} from '@/features/orders/hooks/use-orders';
import type { OrderListItem, OrderQuery } from '@/features/orders/types';

export default function OrdersPage() {
  return (
    <RequirePermission permission="order.read" message="Bạn không có quyền truy cập Order.">
      <OrdersView />
    </RequirePermission>
  );
}

function OrdersView() {
  const [query, setQuery] = useState<OrderQuery>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');
  const [supplierInput, setSupplierInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const debouncedSupplier = useDebouncedValue(supplierInput, 350);
  const [deleting, setDeleting] = useState<OrderListItem | null>(null);
  const [claimTarget, setClaimTarget] = useState<OrderListItem | null>(null);

  const { user, hasPermission } = useAuth();
  // Chỉ ADMIN (quyền gán Seller) mới thấy filter Seller & fetch danh sách Seller.
  const canSeeSeller = hasPermission('account.assign');
  const canClaim = hasPermission('order.claim');
  const canRelease = hasPermission('order.release');

  const ordersQuery = useOrders(query);
  const platformsQuery = usePlatforms();
  const accountsQuery = useOrderAccounts(query.platformId);
  const sellersQuery = useOrderSellers(canSeeSeller);
  const deleteMutation = useDeleteOrder();
  const claimMutation = useClaimOrder();
  const releaseMutation = useReleaseOrder();

  const patchQuery = (patch: Partial<OrderQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const next = debouncedSearch || undefined;
    setQuery((prev) => (prev.search === next ? prev : { ...prev, search: next, page: 1 }));
  }, [debouncedSearch]);

  useEffect(() => {
    const next = debouncedSupplier || undefined;
    setQuery((prev) => (prev.supplier === next ? prev : { ...prev, supplier: next, page: 1 }));
  }, [debouncedSupplier]);

  const items = ordersQuery.data?.items ?? [];
  const meta = ordersQuery.data?.meta;

  const handleConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Đã xóa Order', { description: deleting.orderNumber });
      setDeleting(null);
    } catch (error) {
      toast.error('Xóa thất bại', { description: getApiErrorMessage(error) });
    }
  };

  const handleConfirmClaim = async () => {
    if (!claimTarget) return;
    try {
      await claimMutation.mutateAsync(claimTarget.id);
      toast.success('Bạn đã nhận xử lý đơn hàng.');
      setClaimTarget(null);
    } catch (error) {
      toast.error('Không thể nhận xử lý', { description: getApiErrorMessage(error) });
    }
  };

  const handleRelease = async (id: string) => {
    try {
      await releaseMutation.mutateAsync(id);
      toast.success('Đã release đơn hàng.');
    } catch (error) {
      toast.error('Release thất bại', { description: getApiErrorMessage(error) });
    }
  };

  const openClaim = (id: string) => {
    const target = items.find((o) => o.id === id) ?? null;
    setClaimTarget(target);
  };

  const busyId = claimMutation.isPending
    ? claimMutation.variables ?? null
    : releaseMutation.isPending
      ? releaseMutation.variables ?? null
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Order</h1>
          <p className="text-sm text-muted-foreground">Quản lý đơn hàng.</p>
        </div>
        {hasPermission('order.create') && (
          <Button asChild>
            <Link href="/dashboard/orders/create">
              <Plus className="size-4" />
              Thêm Order
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <OrderFilter
            search={searchInput}
            status={query.status}
            platformId={query.platformId}
            accountId={query.accountId}
            supplier={supplierInput}
            sellerUserId={query.sellerUserId}
            dateFrom={query.dateFrom}
            dateTo={query.dateTo}
            platforms={platformsQuery.data ?? []}
            accounts={accountsQuery.data?.items ?? []}
            sellers={sellersQuery.data ?? []}
            showSeller={canSeeSeller}
            onSearchChange={setSearchInput}
            onStatusChange={(status) => patchQuery({ status, page: 1 })}
            onPlatformChange={(platformId) => patchQuery({ platformId, accountId: undefined, page: 1 })}
            onAccountChange={(accountId) => patchQuery({ accountId, page: 1 })}
            onSupplierChange={setSupplierInput}
            onSellerChange={(sellerUserId) => patchQuery({ sellerUserId, page: 1 })}
            onDateFromChange={(dateFrom) => patchQuery({ dateFrom, page: 1 })}
            onDateToChange={(dateTo) => patchQuery({ dateTo, page: 1 })}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {ordersQuery.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {getApiErrorMessage(ordersQuery.error, 'Không tải được danh sách Order')}
            </p>
          ) : (
            <OrderTable
              orders={items}
              loading={ordersQuery.isLoading}
              currentUserId={user?.id}
              canClaim={canClaim}
              canRelease={canRelease}
              busyId={busyId}
              onDelete={setDeleting}
              onClaim={openClaim}
              onRelease={handleRelease}
            />
          )}

          {meta && meta.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Trang {meta.page}/{meta.totalPages} · {meta.total} Order
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => patchQuery({ page: meta.page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                  Trước
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => patchQuery({ page: meta.page + 1 })}
                >
                  Sau
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Xóa Order"
        description={`Bạn có chắc muốn xóa đơn "${deleting?.orderNumber ?? ''}"? Order sẽ bị xóa mềm.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteMutation.isPending}>
            Hủy
          </Button>
          <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending && <Loader2 className="animate-spin" />}
            Xóa
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(claimTarget)}
        onClose={() => setClaimTarget(null)}
        title="Nhận xử lý đơn hàng"
        description="Nếu nhận xử lý, các Fulfillment khác sẽ không thể chỉnh sửa đơn hàng này."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setClaimTarget(null)} disabled={claimMutation.isPending}>
            Hủy
          </Button>
          <Button onClick={handleConfirmClaim} disabled={claimMutation.isPending}>
            {claimMutation.isPending && <Loader2 className="animate-spin" />}
            Xác nhận nhận xử lý
          </Button>
        </div>
      </Modal>
    </div>
  );
}
