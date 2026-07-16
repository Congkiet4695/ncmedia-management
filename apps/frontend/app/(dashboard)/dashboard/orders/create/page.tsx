'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { getApiErrorMessage } from '@/utils/http';
import { RequirePermission } from '@/components/require-permission';
import { usePlatforms } from '@/features/accounts/hooks/use-accounts';
import { OrderForm } from '@/features/orders/components/order-form';
import { useCreateOrder, useOrderAccounts } from '@/features/orders/hooks/use-orders';
import { toCreateOrderPayload } from '@/features/orders/utils/form-payload';
import type { OrderFormInput } from '@/features/orders/schemas/order.schema';

export default function CreateOrderPage() {
  return (
    <RequirePermission permission="order.create" message="Bạn không có quyền tạo Order.">
      <CreateOrderView />
    </RequirePermission>
  );
}

function CreateOrderView() {
  const router = useRouter();
  const [platformId, setPlatformId] = useState<string>('');
  const platformsQuery = usePlatforms();
  const accountsQuery = useOrderAccounts(platformId || undefined);
  const createMutation = useCreateOrder();

  const onSubmit = async (values: OrderFormInput) => {
    try {
      await createMutation.mutateAsync(toCreateOrderPayload(values));
      toast.success('Tạo Order thành công');
      router.push('/dashboard/orders');
    } catch (error) {
      toast.error('Tạo Order thất bại', { description: getApiErrorMessage(error) });
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

      <Card>
        <CardHeader>
          <CardTitle>Thêm Order</CardTitle>
          <CardDescription>Chọn nền tảng → Account → nhập thông tin đơn và sản phẩm.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="platform-filter">Nền tảng (lọc Account)</Label>
            <NativeSelect
              id="platform-filter"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
            >
              <option value="">Tất cả nền tảng</option>
              {(platformsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <OrderForm
            mode="create"
            accounts={accountsQuery.data?.items ?? []}
            submitting={createMutation.isPending}
            onSubmit={onSubmit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
