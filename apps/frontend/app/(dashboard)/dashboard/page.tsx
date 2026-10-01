import { DashboardHeading } from './_components/dashboard-heading';
import { ProfileSummary } from './_components/profile-summary';
import { DashboardSummary } from './_components/dashboard-summary';
import { AdminDashboard } from '@/features/dashboard/components/admin-dashboard';

/**
 * Trang Dashboard — tóm tắt phiên (Avatar/Fullname/Organization/Role) + Dashboard Summary
 * (Tổng Đơn hàng + Tổng Doanh thu, theo bộ lọc thời gian dùng chung). Summary chỉ hiển thị
 * với người có quyền `report.read`.
 *
 * `AdminDashboard` (Hold · shop · đơn theo kỳ · tài chính · seller · xu hướng của POD / TikTok Shop) —
 * cùng quyền `report.read`; phạm vi dữ liệu do backend giới hạn. Các khối cũ giữ nguyên.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <DashboardHeading />

      <AdminDashboard />

      <DashboardSummary />

      <ProfileSummary />
    </div>
  );
}
