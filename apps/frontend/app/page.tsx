import { redirect } from 'next/navigation';

/**
 * Trang gốc — điều hướng tới /login.
 * Người dùng đã đăng nhập truy cập /dashboard sẽ qua guard của nhóm (dashboard).
 */
export default function RootPage() {
  redirect('/login');
}
