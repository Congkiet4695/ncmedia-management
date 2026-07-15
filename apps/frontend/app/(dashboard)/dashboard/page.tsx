import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Trang Dashboard — PLACEHOLDER (chỉ layout, chưa có nghiệp vụ).
 * Nội dung thống kê/báo cáo sẽ triển khai theo Sprint tương ứng.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Khu vực tổng quan — chưa triển khai nghiệp vụ.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Layout sẵn sàng</CardTitle>
          <CardDescription>
            Đây chỉ là khung layout Dashboard. Nội dung nghiệp vụ (thống kê doanh thu, đơn hàng,
            báo cáo…) sẽ được thêm theo đúng Sprint &amp; workflow ADR-019.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Bạn đã đăng nhập thành công; khu vực này được bảo vệ bởi guard phía client.
        </CardContent>
      </Card>
    </div>
  );
}
