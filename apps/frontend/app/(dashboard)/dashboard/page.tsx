import type { Metadata } from 'next';
import { ProfileSummary } from './_components/profile-summary';
import { DashboardSummary } from './_components/dashboard-summary';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Trang Dashboard — tóm tắt phiên (Avatar/Fullname/Organization/Role) + Dashboard Summary
 * (Tổng Đơn hàng + Tổng Doanh thu, theo bộ lọc thời gian dùng chung). Summary chỉ hiển thị
 * với người có quyền `report.read`.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Tổng quan hoạt động kinh doanh.</p>
      </div>

      <DashboardSummary />

      <ProfileSummary />
    </div>
  );
}
