'use client';

import { useState, type KeyboardEvent } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { parseDesignAmount } from '../../design-amount';
import { useUpdatePodOrderDesignAmount } from '../../hooks/use-pod-orders';

interface DesignAmountLineProps {
  orderId: string;
  amount: number;
  currency: string;
}

/**
 * Dòng **Design Amount** ngay dưới Label cost trong cột Giá — sửa tại chỗ.
 *
 * - Bấm bút chì ⇒ ô nhập; Enter / ✓ lưu, Esc / ✕ huỷ. Không có quyền `pod.tiktok.order.update` ⇒ chỉ hiển thị
 *   (backend vẫn kiểm quyền + phạm vi shop ở mọi request).
 * - 🔴 `orderId` chốt lúc bấm Lưu và component được `key` theo đơn ⇒ đổi trang / đổi đơn giữa chừng không bao giờ
 *   ghi nhầm giá trị sang đơn khác.
 * - Lưu xong: backend trả lợi nhuận đã tính lại; danh sách + Dashboard được làm mới (không tải lại trang).
 */
export function DesignAmountLine({ orderId, amount, currency }: DesignAmountLineProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatCurrency } = useLocaleFormat();
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('pod.tiktok.order.update');
  const update = useUpdatePodOrderDesignAmount();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const parsed = editing ? parseDesignAmount(draft) : null;
  const invalid = editing && draft.trim() !== '' && parsed === null;

  const cancel = () => setDraft(null);

  const save = async () => {
    if (draft === null) return;
    const next = parseDesignAmount(draft);
    if (next === null) {
      toast.error(t('orders.price.designAmountInvalid'));
      return;
    }
    if (next === amount) {
      cancel();
      return;
    }
    const targetOrderId = orderId;
    try {
      await update.mutateAsync({ id: targetOrderId, designAmount: next });
      toast.success(t('orders.price.designAmountSaved'));
      setDraft(null);
    } catch (error) {
      toast.error(t('orders.price.designAmountFailed'), { description: translateApiError(error) });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 text-left text-muted-foreground opacity-80">{t('orders.price.designAmount')}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={update.isPending}
            aria-invalid={invalid}
            aria-label={t('orders.price.designAmount')}
            className={`h-6 w-20 px-1 text-right text-[11px] tabular-nums ${invalid ? 'border-destructive' : ''}`}
          />
          <button
            type="button"
            className="rounded p-0.5 text-success hover:bg-muted disabled:opacity-50"
            onClick={() => void save()}
            disabled={update.isPending || parsed === null}
            aria-label={t('common:action.save')}
          >
            {update.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
            onClick={cancel}
            disabled={update.isPending}
            aria-label={t('common:action.cancel')}
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <Tooltip content={t('orders.price.designAmountHint')}>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 text-left text-muted-foreground opacity-80">{t('orders.price.designAmount')}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums text-muted-foreground">
          {formatCurrency(amount, currency)}
          {canEdit && (
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted hover:text-foreground"
              onClick={() => setDraft(amount === 0 ? '' : String(amount))}
              aria-label={t('orders.price.designAmountEdit')}
              title={t('orders.price.designAmountEdit')}
            >
              <Pencil className="size-3" />
            </button>
          )}
        </span>
      </div>
    </Tooltip>
  );
}
