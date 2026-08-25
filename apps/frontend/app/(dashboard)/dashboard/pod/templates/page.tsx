import { redirect } from 'next/navigation';

/**
 * `/dashboard/pod/templates` — cửa vào khu Template Engine.
 *
 * Khu này gồm sáu tab, không có màn hình tổng nào ở chính đường dẫn gốc, nên vào đây thì
 * chuyển thẳng sang tab đầu tiên. Thiếu file này thì Next không có `page.tsx` cho segment
 * `templates` và trả về **404** — đúng lỗi người dùng gặp khi bấm "Templates" ở sidebar.
 *
 * Thanh tab nằm ở `layout.tsx` cạnh file này nên vẫn hiển thị bình thường sau khi chuyển.
 */
export default function PodTemplatesIndexPage() {
  redirect('/dashboard/pod/templates/categories');
}
