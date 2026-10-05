'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useApiError } from '@/hooks/use-api-error';
import { useUpdateBaseCost } from '../hooks/use-fulfillment';
import type { FulfillmentOrder } from '../types';

/** Số chữ số thập phân của một đơn vị tiền (USD 2, JPY 0) — cùng nguồn ISO 4217 với backend (`Intl`). */
function fractionDigitsOf(currency: string): number | null {
  try {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return null;
  }
}

/** Lỗi của MỘT ô giá vốn — `null` = hợp lệ. Chỉ là lớp trải nghiệm; backend kiểm lại toàn bộ. */
function costProblem(raw: string, digits: number | null): 'REQUIRED' | 'NOT_NUMBER' | 'NEGATIVE' | 'DECIMALS' | null {
  const value = raw.trim();
  if (!value) return 'REQUIRED';
  if (!/^\d+(\.\d+)?$/.test(value) && !/^-/.test(value)) return 'NOT_NUMBER';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'NOT_NUMBER';
  if (parsed < 0) return 'NEGATIVE';
  const fraction = value.split('.')[1] ?? '';
  if (digits !== null && fraction.length > digits) return 'DECIMALS';
  return null;
}

interface BaseCostDialogProps {
  open: boolean;
  onClose: () => void;
  podOrderId: string;
  fulfillment: FulfillmentOrder;
}

/**
 * **Update Base Cost** — Admin nhập tay giá vốn cho đơn ĐÃ fulfill mà hệ thống chưa có giá.
 *
 * 🔴 Một ô cho MỖI dòng hàng của lần fulfill (đơn 1 dòng ⇒ đúng một ô "Base Cost"): giá vốn của đơn là
 * Σ giá từng dòng, không chia đều một con số cho nhiều dòng. Đơn vị tiền theo bản ghi; chưa có thì phải
 * chọn. Lưu xong, cột Fulfillment / Lợi nhuận / Margin làm mới ngay (không tải lại trang).
 */
export function BaseCostDialog({ open, onClose, podOrderId, fulfillment }: BaseCostDialogProps) {
  const { t } = useTranslation(['fulfillment', 'common']);
  const translateApiError = useApiError();
  const update = useUpdateBaseCost(podOrderId);

  const [values, setValues] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState(fulfillment.currency ?? '');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(
      Object.fromEntries(
        fulfillment.items.map((item) => [item.id, item.baseCost === null ? '' : String(item.baseCost)]),
      ),
    );
    setCurrency(fulfillment.currency ?? '');
    setReason('');
    setSubmitted(false);
  }, [open, fulfillment]);

  const normalizedCurrency = currency.trim().toUpperCase();
  const digits = /^[A-Z]{3}$/.test(normalizedCurrency) ? fractionDigitsOf(normalizedCurrency) : null;
  const currencyError = !normalizedCurrency
    ? t('fulfillment:baseCost.error.CURRENCY_REQUIRED')
    : digits === null
      ? t('fulfillment:baseCost.error.CURRENCY_INVALID')
      : null;
  const problems = useMemo(
    () => Object.fromEntries(fulfillment.items.map((item) => [item.id, costProblem(values[item.id] ?? '', digits)])),
    [fulfillment.items, values, digits],
  );
  const valid = !currencyError && Object.values(problems).every((problem) => problem === null);
  const total = valid
    ? fulfillment.items.reduce((sum, item) => sum + Number(values[item.id]) * (item.quantity || 1), 0)
    : null;

  const save = (): void => {
    setSubmitted(true);
    if (!valid) return;
    void update
      .mutateAsync({
        items: fulfillment.items.map((item) => ({ itemId: item.id, baseCost: Number(values[item.id]) })),
        ...(fulfillment.currency ? {} : { currency: normalizedCurrency }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      .then(() => {
        toast.success(t('fulfillment:baseCost.saved'));
        onClose();
      })
      .catch((error: unknown) => toast.error(translateApiError(error)));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('fulfillment:baseCost.title')}
      description={t('fulfillment:baseCost.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={save} disabled={update.isPending || (submitted && !valid)}>
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('common:action.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!fulfillment.currency && (
          <div className="space-y-1.5">
            <Label htmlFor="base-cost-currency">{t('fulfillment:baseCost.currency')}</Label>
            <Input
              id="base-cost-currency"
              value={currency}
              maxLength={3}
              placeholder="USD"
              className="w-28 uppercase"
              onChange={(event) => setCurrency(event.target.value)}
              aria-invalid={submitted && currencyError ? true : undefined}
            />
            {submitted && currencyError && <p className="text-xs text-destructive">{currencyError}</p>}
          </div>
        )}

        {fulfillment.items.map((item) => {
          const problem = submitted ? problems[item.id] : null;
          return (
            <div key={item.id} className="space-y-1.5">
              <Label htmlFor={`base-cost-${item.id}`}>
                {fulfillment.items.length === 1
                  ? t('fulfillment:baseCost.field')
                  : t('fulfillment:baseCost.fieldForSku', { sku: item.providerSku, quantity: item.quantity })}
              </Label>
              <CurrencyInput
                id={`base-cost-${item.id}`}
                currency={normalizedCurrency || null}
                inputMode="decimal"
                value={values[item.id] ?? ''}
                onChange={(event) => setValues((prev) => ({ ...prev, [item.id]: event.target.value }))}
                aria-invalid={problem ? true : undefined}
              />
              {problem && (
                <p className="text-xs text-destructive">
                  {t(`fulfillment:baseCost.error.${problem}`, { digits: digits ?? 2 })}
                </p>
              )}
            </div>
          );
        })}

        <div className="space-y-1.5">
          <Label htmlFor="base-cost-reason">{t('fulfillment:baseCost.reason')}</Label>
          <Input
            id="base-cost-reason"
            value={reason}
            maxLength={500}
            placeholder={t('fulfillment:baseCost.reasonPlaceholder')}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {total !== null && fulfillment.items.length > 1 && (
          <p className="text-sm text-muted-foreground">
            {t('fulfillment:baseCost.total', { total: total.toFixed(digits ?? 2), currency: normalizedCurrency })}
          </p>
        )}
      </div>
    </Modal>
  );
}
