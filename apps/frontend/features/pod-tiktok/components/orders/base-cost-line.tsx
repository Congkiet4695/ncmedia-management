'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useUpdateOrderBaseCost } from '@/features/fulfillment/hooks/use-fulfillment';
import { parseOrderBaseCost } from '@/features/fulfillment/order-base-cost';

interface BaseCostLineProps {
  orderId: string;
  /** Base cost hiện tại (Σ giá vốn của lần fulfill đang hiệu lực) — `null` = chưa có giá. */
  amount: number | null;
  /** Đơn vị tiền của giá vốn trên bản ghi fulfillment — `null` ⇒ không sửa tại chỗ được. */
  currency: string | null;
  /** Chuỗi đã định dạng để hiển thị (do cột Giá định dạng, giữ nguyên cách hiển thị cũ). */
  display: string;
  hint?: ReactNode;
}

/**
 * Dòng **Base cost** trong cột Giá — Admin sửa tại chỗ.
 *
 * - Chỉ người có `fulfillment.basecost.update` (mặc định chỉ Admin) thấy bút chì; người khác thấy đúng dòng
 *   hiển thị cũ. Backend kiểm lại quyền + phạm vi shop + luật nghiệp vụ ở mọi request.
 * - Chỉ đơn ĐÃ fulfill có đơn vị tiền giá vốn mới có bút chì. Đơn nhiều dòng hàng ⇒ backend trả `MULTI_ITEM`,
 *   thông báo hướng dẫn dùng "Cập nhật Base Cost" ở cột Fulfillment (nhập từng dòng).
 * - Enter / ✓ lưu, Esc / ✕ huỷ (giá trị chưa lưu bị bỏ). Đang lưu ⇒ khoá ô + nút (không gửi trùng).
 * - Lưu xong: danh sách đơn + Dashboard được làm mới ⇒ Lợi nhuận / Margin hiển thị số backend tính lại.
 *   Lưu lỗi ⇒ giữ ô nhập để sửa, số hiển thị vẫn là giá cũ.
 */
export function BaseCostLine({ orderId, amount, currency, display, hint }: BaseCostLineProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('fulfillment.basecost.update') && currency !== null;
  const update = useUpdateOrderBaseCost();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null && currency !== null;
  const parsed = editing ? parseOrderBaseCost(draft, currency) : null;
  const invalid = editing && draft.trim() !== '' && parsed !== null && !parsed.ok;

  const cancel = () => setDraft(null);

  const save = async () => {
    if (draft === null || currency === null || update.isPending) return;
    const result = parseOrderBaseCost(draft, currency);
    if (!result.ok) {
      toast.error(t(`orders.price.baseCostInvalid.${result.error}`, { currency }));
      return;
    }
    if (result.value === amount) {
      cancel();
      return;
    }
    const targetOrderId = orderId;
    try {
      await update.mutateAsync({ podOrderId: targetOrderId, baseCost: result.value });
      toast.success(t('orders.price.baseCostSaved'));
      setDraft(null);
    } catch (error) {
      toast.error(t('orders.price.baseCostFailed'), { description: translateApiError(error) });
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
        <span className="min-w-0 text-left text-muted-foreground opacity-80">{t('orders.price.baseCost')}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={update.isPending}
            aria-invalid={invalid}
            aria-label={t('orders.price.baseCost')}
            className={`h-6 w-20 px-1 text-right text-[11px] tabular-nums ${invalid ? 'border-destructive' : ''}`}
          />
          <button
            type="button"
            className="rounded p-0.5 text-success hover:bg-muted disabled:opacity-50"
            onClick={() => void save()}
            disabled={update.isPending || !parsed?.ok}
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

  const body = (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="min-w-0 text-left text-muted-foreground opacity-80">{t('orders.price.baseCost')}</span>
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums text-muted-foreground">
        {display}
        {canEdit && (
          <button
            type="button"
            className="rounded p-0.5 hover:bg-muted hover:text-foreground"
            onClick={() => setDraft(amount === null ? '' : String(amount))}
            aria-label={t('orders.price.baseCostEdit')}
            title={t('orders.price.baseCostEdit')}
          >
            <Pencil className="size-3" />
          </button>
        )}
      </span>
    </div>
  );

  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}
