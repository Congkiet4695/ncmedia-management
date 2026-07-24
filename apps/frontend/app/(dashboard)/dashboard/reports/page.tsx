import { redirect } from 'next/navigation';

/** /dashboard/reports → điều hướng tới báo cáo Tổng quan. */
export default function ReportsIndexPage() {
  redirect('/dashboard/reports/overview');
}
