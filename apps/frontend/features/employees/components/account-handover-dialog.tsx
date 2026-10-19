'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DataPagination } from '@/components/ui/data-pagination';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import { useAccountHandoverTransactions, useUpdateAccountHandover } from '../hooks/use-employees';
import type { EmployeeListItem } from '../types';

/** Đơn vị tiền của Tiền giao account (khớp `ACCOUNT_HANDOVER_CURRENCY` của backend). */
const HANDOVER_CURRENCY = 'USD';
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const HISTORY_PAGE_SIZE = 10;

interface AccountHandoverDialogProps {
  /** Nhân viên đang xem; `null` = đóng. */
  employee: EmployeeListItem | null;
  onClose: () => void;
}

/**
 * "Tiền giao account" — chỉnh tay + lịch sử.
 *
 * - Lưu gửi kèm `expectedAmount` = số đang thấy: nếu vừa có khoản cộng tự động (link / assign) thì backend trả
 *   409 thay vì ghi đè ⇒ không làm mất khoản vừa cộng; danh sách tự tải lại số mới.
 * - Mỗi lần chỉnh tay là một dòng lịch sử (trước / sau / người sửa / ghi chú) — lịch sử cộng tự động giữ nguyên.
 */
export function AccountHandoverDialog({ employee, onClose }: AccountHandoverDialogProps) {
  const { t } = useTranslation(['employee', 'common']);
  const { formatCurrency, formatDateTime } = useLocaleFormat();
  const translateApiError = useApiError();
  const update = useUpdateAccountHandover();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [page, setPage] = useState(1);
  const history = useAccountHandoverTransactions(employee?.id, page, HISTORY_PAGE_SIZE);

  useEffect(() => {
    if (!employee) return;
    setAmount(String(employee.accountHandoverAmount));
    setNote('');
    setPage(1);
  }, [employee]);

  const parsed = MONEY_PATTERN.test(amount.trim().replace(',', '.')) ? Number(amount.trim().replace(',', '.')) : null;
  const invalid = amount.trim() !== '' && parsed === null;
  const money = (value: number) => formatCurrency(value, HANDOVER_CURRENCY);

  const handleSave = async () => {
    if (!employee || parsed === null) return;
    const employeeId = employee.id;
    if (parsed === employee.accountHandoverAmount) {
      toast.info(t('accountHandover.noChanges'));
      return;
    }
    try {
      await update.mutateAsync({
        id: employeeId,
        payload: { amount: parsed, expectedAmount: employee.accountHandoverAmount, note: note.trim() || undefined },
      });
      toast.success(t('accountHandover.saved'), { description: employee.fullName });
      onClose();
    } catch (error) {
      toast.error(t('accountHandover.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Modal
      open={Boolean(employee)}
      onClose={onClose}
      title={t('accountHandover.title')}
      description={employee?.fullName}
      className="max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={update.isPending || parsed === null}>
            {update.isPending && <Loader2 className="animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div className="space-y-2">
            <Label htmlFor="accountHandoverAmount">{t('accountHandover.amountLabel')}</Label>
            <Input
              id="accountHandoverAmount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={invalid}
              className={cn('text-right tabular-nums', invalid && 'border-destructive')}
              disabled={update.isPending}
            />
            {invalid && <p className="text-sm text-destructive">{t('accountHandover.invalid')}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountHandoverNote">{t('accountHandover.noteLabel')}</Label>
            <Input
              id="accountHandoverNote"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('accountHandover.notePlaceholder')}
              disabled={update.isPending}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('accountHandover.rule')}</p>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('accountHandover.historyTitle')}</p>
          {history.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.isError ? (
            <p className="py-4 text-center text-sm text-destructive">{translateApiError(history.error)}</p>
          ) : (history.data?.items.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('accountHandover.historyEmpty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">{t('accountHandover.col.time')}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t('accountHandover.col.type')}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t('accountHandover.col.account')}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t('accountHandover.col.amount')}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t('accountHandover.col.balance')}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t('accountHandover.col.actor')}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t('accountHandover.col.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data?.items.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{t(`accountHandover.type.${row.type}`)}</td>
                      <td className="px-2 py-1.5">{row.tiktokAccountName ?? '—'}</td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-2 py-1.5 text-right tabular-nums font-medium',
                          row.amount >= 0 ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {row.amount >= 0 ? '+' : '−'}
                        {formatCurrency(Math.abs(row.amount), row.currency)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(row.balanceBefore, row.currency)} → {formatCurrency(row.balanceAfter, row.currency)}
                      </td>
                      <td className="px-2 py-1.5">{row.actorName ?? '—'}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{row.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DataPagination meta={history.data?.meta} onPageChange={setPage} disabled={history.isFetching} />
        </div>
        {employee && (
          <p className="text-xs text-muted-foreground">
            {t('accountHandover.current', { amount: money(employee.accountHandoverAmount) })}
          </p>
        )}
      </div>
    </Modal>
  );
}
