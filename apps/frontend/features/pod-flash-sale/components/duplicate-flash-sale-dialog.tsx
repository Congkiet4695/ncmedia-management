'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { localToUtcIso, utcIsoToLocal } from '../timezone';
import { FLASH_SALE_MAX_NAME_LENGTH, type DuplicateFlashSalePayload } from '../types';

interface DuplicateFlashSaleDialogProps {
  open: boolean;
  onClose: () => void;
  source: {
    name: string;
    startAt: string;
    endAt: string;
    timezone: string;
    itemCount: number;
  } | null;
  submitting?: boolean;
  onSubmit: (payload: DuplicateFlashSalePayload) => void;
}

/**
 * **Duplicate** — mục tiêu của cả sprint: tạo đợt sale hôm sau trong khoảng 10 giây.
 *
 * Dialog chỉ hỏi đúng ba thứ người dùng thực sự cần đổi — **tên, giờ bắt đầu, giờ kết thúc**.
 * Sản phẩm, giá deal, % giảm và giới hạn mua đi theo bản sao mà không phải nhập lại gì.
 *
 * 🔴 Đổi giờ bắt đầu mà để trống giờ kết thúc ⇒ backend giữ nguyên **độ dài** đợt gốc. Dialog
 * gợi ý sẵn con số đó để người dùng nhìn thấy trước, nhưng luật nằm ở server.
 */
export function DuplicateFlashSaleDialog({
  open,
  onClose,
  source,
  submitting,
  onSubmit,
}: DuplicateFlashSaleDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const [name, setName] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');

  const timezone = source?.timezone ?? 'UTC';

  useEffect(() => {
    if (!open || !source) return;
    // Hậu tố " Copy" giống hệt quy ước của backend — người dùng thấy trước đúng cái tên sẽ
    // được lưu, và vẫn sửa được ngay tại đây.
    setName(`${source.name} Copy`.slice(0, FLASH_SALE_MAX_NAME_LENGTH));
    setStartLocal(utcIsoToLocal(source.startAt, timezone));
    setEndLocal(utcIsoToLocal(source.endAt, timezone));
  }, [open, source, timezone]);

  /** Dời giờ bắt đầu thì dời luôn giờ kết thúc, giữ nguyên độ dài đợt. */
  const onStartChange = (value: string): void => {
    if (source && startLocal && endLocal) {
      const previousStart = new Date(`${startLocal}:00Z`).getTime();
      const previousEnd = new Date(`${endLocal}:00Z`).getTime();
      const next = new Date(`${value}:00Z`).getTime();
      if (Number.isFinite(previousStart) && Number.isFinite(previousEnd) && Number.isFinite(next)) {
        setEndLocal(new Date(next + (previousEnd - previousStart)).toISOString().slice(0, 16));
      }
    }
    setStartLocal(value);
  };

  const submit = (): void => {
    onSubmit({
      name: name.trim() || undefined,
      startAt: localToUtcIso(startLocal, timezone) ?? undefined,
      endAt: localToUtcIso(endLocal, timezone) ?? undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('flashSale.duplicate.title')}
      description={t('flashSale.duplicate.subtitle', { count: source?.itemCount ?? 0 })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('flashSale.duplicate.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="duplicate-name">{t('flashSale.form.name')}</Label>
          <Input
            id="duplicate-name"
            value={name}
            maxLength={FLASH_SALE_MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-start">{t('flashSale.form.startAt')}</Label>
            <Input
              id="duplicate-start"
              type="datetime-local"
              value={startLocal}
              onChange={(event) => onStartChange(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-end">{t('flashSale.form.endAt')}</Label>
            <Input
              id="duplicate-end"
              type="datetime-local"
              value={endLocal}
              onChange={(event) => setEndLocal(event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('flashSale.duplicate.hint', { timezone })}
        </p>
      </div>
    </Modal>
  );
}
