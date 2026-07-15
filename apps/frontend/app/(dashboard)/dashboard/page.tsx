import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileSummary } from './_components/profile-summary';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Trang Dashboard — chỉ layout + tóm tắt phiên (Avatar/Fullname/Organization/Role).
 * KHÔNG có nghiệp vụ (thống kê/báo cáo) — sẽ triển khai theo Sprint tương ứng.
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

      <ProfileSummary />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Layout sẵn sàng</CardTitle>
          <CardDescription>
            Đây chỉ là khung layout Dashboard. Nội dung nghiệp vụ (thống kê doanh thu, đơn hàng,
            báo cáo…) sẽ được thêm theo đúng Sprint &amp; workflow ADR-019.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Bạn đã đăng nhập thành công; khu vực này được bảo vệ bởi middleware + AuthProvider.
        </CardContent>
      </Card>
    </div>
  );
}
