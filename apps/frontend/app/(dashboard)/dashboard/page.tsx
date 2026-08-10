import { DashboardHeading } from './_components/dashboard-heading';
import { ProfileSummary } from './_components/profile-summary';
import { DashboardSummary } from './_components/dashboard-summary';

/**
 * Trang Dashboard — tóm tắt phiên (Avatar/Fullname/Organization/Role) + Dashboard Summary
 * (Tổng Đơn hàng + Tổng Doanh thu, theo bộ lọc thời gian dùng chung). Summary chỉ hiển thị
 * với người có quyền `report.read`.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <DashboardHeading />

      <DashboardSummary />

      <ProfileSummary />
    </div>
  );
}
