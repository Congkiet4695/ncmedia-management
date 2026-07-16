'use client';

import Link from 'next/link';
import { Loader2, PackageCheck, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Badge cột Fulfillment (Requirement 4): "Chưa nhận" (xám) / tên người xử lý (xanh). */
export function OrderFulfillmentBadge({ name }: { name: string | null }) {
  if (!name) return <Badge variant="muted">Chưa nhận</Badge>;
  return <Badge variant="success">{name}</Badge>;
}

interface ClaimActionProps {
  orderId: string;
  fulfilledById: string | null;
  fulfilledByName: string | null;
  isClaimed: boolean;
  currentUserId?: string;
  canClaim: boolean;
  canRelease: boolean;
  busy?: boolean;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
}

/**
 * Action Claim/Release trong Order List (Requirement 13):
 * - Chưa claim + có quyền claim → "Nhận xử lý" (primary).
 * - Claim bởi mình → "Đang xử lý" (success) → mở chi tiết để cập nhật.
 * - Claim bởi người khác → disabled "Đang xử lý bởi X" + tooltip.
 * - Admin (release) + đã claim → nút "Release".
 */
export function OrderClaimAction({
  orderId,
  fulfilledById,
  fulfilledByName,
  isClaimed,
  currentUserId,
  canClaim,
  canRelease,
  busy,
  onClaim,
  onRelease,
}: ClaimActionProps) {
  if (!isClaimed) {
    if (!canClaim) return <span className="text-muted-foreground">—</span>;
    return (
      <Button size="sm" disabled={busy} onClick={() => onClaim(orderId)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
        Nhận xử lý
      </Button>
    );
  }

  const mine = fulfilledById != null && fulfilledById === currentUserId;

  return (
    <div className="flex items-center justify-end gap-1">
      {mine ? (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="border-emerald-500 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
        >
          <Link href={`/dashboard/orders/${orderId}`}>
            <PackageCheck className="size-4" />
            Đang xử lý
          </Link>
        </Button>
      ) : (
        canClaim && (
          <Button
            size="sm"
            variant="outline"
            disabled
            title={`Đang xử lý bởi ${fulfilledByName ?? 'Fulfillment khác'}`}
            className={cn('cursor-not-allowed opacity-70')}
          >
            Đang xử lý bởi {fulfilledByName ?? '—'}
          </Button>
        )
      )}
      {canRelease && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="Release đơn (Admin) — về WAITING"
          onClick={() => onRelease(orderId)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          <span className="hidden lg:inline">Release</span>
        </Button>
      )}
    </div>
  );
}
