import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Order',
};

/**
 * Order — placeholder. Menu hiển thị theo permission `order.read`; module nghiệp vụ Order
 * (đơn hàng) sẽ được triển khai ở sprint sau (ADR-012). Trang này tránh 404 cho menu.
 */
export default function OrderPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Order</h1>
        <p className="text-sm text-muted-foreground">Quản lý đơn hàng.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sắp ra mắt</CardTitle>
          <CardDescription>
            Module Order đang được phát triển. Bạn đã có quyền <code>order.*</code> để truy cập khi
            hoàn thiện.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Chưa có nghiệp vụ Order ở phiên bản hiện tại.
        </CardContent>
      </Card>
    </div>
  );
}
