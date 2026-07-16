import { redirect } from 'next/navigation';

/** Route cũ `/dashboard/order` — module Order dùng `/dashboard/orders`. Redirect để không vỡ link cũ. */
export default function LegacyOrderRedirect() {
  redirect('/dashboard/orders');
}
