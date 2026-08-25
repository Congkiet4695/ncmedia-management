'use client';

import { Badge } from '@/components/ui/badge';

/** Trạng thái nào tô màu gì — một bảng duy nhất cho Session, Draft Product, Job và Job Item. */
const VARIANTS: Record<string, 'success' | 'destructive' | 'warning' | 'muted'> = {
  // Listing Session · Draft Product
  READY: 'success',
  UPLOADED: 'success',
  LISTING: 'warning',
  QUEUED: 'warning',
  // Payload đã gửi
  TIKTOK_DRAFT: 'success',
  PUBLISHED: 'success',
  PUBLISHING: 'warning',
  FAILED: 'destructive',
  // Listing Job
  COMPLETED: 'success',
  COMPLETED_WITH_ERRORS: 'warning',
  PROCESSING: 'warning',
  CANCELLED: 'muted',
  // Listing Job Item
  SUCCESS: 'success',
  RETRYING: 'warning',
  SKIPPED: 'destructive',
  // Trạng thái DUYỆT phía TikTok (Sprint Publish)
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  ACTIVE: 'success',
  OFFLINE: 'muted',
  DELETED: 'muted',
};

/**
 * Badge trạng thái — dùng chung cho Listing Session, Draft Product, Listing Job, Publish
 * History và trạng thái DUYỆT của TikTok. Năm vòng đời khác nhau nhưng người đọc chỉ cần
 * biết "xanh / vàng / đỏ", nên một bảng màu duy nhất là đủ và không bao giờ lệch nhau giữa
 * các màn hình.
 *
 * 🔴 `PUBLISHED` (đã gửi) và `ACTIVE` (đang bán) đều xanh nhưng **không thay thế nhau**: hai
 * cột riêng trên màn hình Draft Listing, vì một listing có thể đã gửi mà vẫn bị từ chối.
 *
 * Đặt ở feature (không phải trong `page.tsx`) vì App Router cấm page export thêm bất kỳ
 * thứ gì ngoài `default` và các biến cấu hình của Next.
 */
export function ListingStatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge variant={VARIANTS[status] ?? 'muted'}>{label ?? status}</Badge>;
}
