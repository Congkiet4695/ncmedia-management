'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

interface SaveTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Tên đợt sale — dùng làm gợi ý tên template. */
  defaultName: string;
  itemCount: number;
  submitting?: boolean;
  onSubmit: (payload: { name: string; description?: string }) => void;
}

/**
 * **Save as Template** — chụp lại cấu hình sản phẩm của đợt sale đang mở.
 *
 * 🔴 Dialog nói rõ NHỮNG GÌ được lưu và những gì KHÔNG. Người dùng sẽ áp lại template này
 * sau vài tuần; nếu họ tưởng nó nhớ cả khung giờ thì đợt sale hôm đó sẽ chạy sai ngày.
 */
export function SaveTemplateDialog({
  open,
  onClose,
  defaultName,
  itemCount,
  submitting,
  onSubmit,
}: SaveTemplateDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setDescription('');
  }, [open, defaultName]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('flashSale.template.saveTitle')}
      description={t('flashSale.template.saveSubtitle', { count: itemCount })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('common:action.cancel')}
          </Button>
          <Button
            onClick={() =>
              onSubmit({ name: name.trim(), description: description.trim() || undefined })
            }
            disabled={name.trim() === '' || submitting}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('common:action.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">{t('flashSale.template.name')}</Label>
          <Input
            id="template-name"
            value={name}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="template-description">{t('flashSale.template.description')}</Label>
          <Input
            id="template-description"
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t('flashSale.template.savesTitle')}</p>
          <p>{t('flashSale.template.saves')}</p>
          <p className="mt-1 font-medium text-foreground">
            {t('flashSale.template.notSavesTitle')}
          </p>
          <p>{t('flashSale.template.notSaves')}</p>
        </div>
      </div>
    </Modal>
  );
}
