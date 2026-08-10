'use client';

import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

interface CredentialsDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Có email → hiển thị thêm dòng Email + nút "Copy tất cả" (dùng cho tạo mới). */
  email?: string;
  password: string;
  onClose: () => void;
}

/**
 * Copy vào clipboard rồi báo kết quả.
 *
 * Nhận sẵn câu thông báo ĐÃ DỊCH thay vì tự gọi `t`: hàm nằm ngoài component nên
 * không dùng được hook, và truyền chuỗi vào giữ cho hàm thuần tuý, dễ kiểm thử.
 */
async function copyText(text: string, okMessage: string, failMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error(failMessage);
  }
}

function ReadonlyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-sm">{value}</code>
        <Button type="button" variant="outline" size="icon" aria-label={`Copy ${label}`} onClick={onCopy}>
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * CredentialsDialog — hiển thị thông tin đăng nhập **một lần** (tạo mới / reset mật khẩu).
 * Có nút copy từng phần và "Copy tất cả" (khi có email).
 */
export function CredentialsDialog({
  open,
  title,
  description,
  email,
  password,
  onClose,
}: CredentialsDialogProps) {
  const { t } = useTranslation(['employee', 'common', 'auth']);
  // Dựng sẵn hai câu thông báo để hàm copy nằm ngoài component không cần gọi `t`.
  const copyFail = t('common:action.copyManual');
  const copy = (text: string, label: string) =>
    void copyText(text, t('common:action.copied', { label }), copyFail);

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="space-y-4">
        {email && (
          <ReadonlyField
            label={t('auth:login.email')}
            value={email}
            onCopy={() => copy(email, t('auth:login.email'))}
          />
        )}
        <ReadonlyField
          label={t('auth:login.password')}
          value={password}
          onCopy={() => copy(password, t('auth:login.password'))}
        />

        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('passwordOnce')}
        </p>

        <div className="flex justify-end gap-2">
          {email && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                copy(
                  `${t('auth:login.email')}: ${email}\n${t('auth:login.password')}: ${password}`,
                  t('common:action.copyAll'),
                )
              }
            >
              <Copy className="size-4" />
              {t('common:action.copyAll')}
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            {t('common:action.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
