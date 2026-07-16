'use client';

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

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Đã copy ${label}`);
  } catch {
    toast.error('Không copy được — vui lòng copy thủ công');
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
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="space-y-4">
        {email && (
          <ReadonlyField label="Email" value={email} onCopy={() => void copyText(email, 'email')} />
        )}
        <ReadonlyField
          label="Mật khẩu"
          value={password}
          onCopy={() => void copyText(password, 'mật khẩu')}
        />

        <p className="text-xs text-amber-600 dark:text-amber-400">
          Mật khẩu chỉ hiển thị một lần. Hãy lưu lại và chuyển an toàn cho nhân viên.
        </p>

        <div className="flex justify-end gap-2">
          {email && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyText(`Email: ${email}\nMật khẩu: ${password}`, 'tất cả')}
            >
              <Copy className="size-4" />
              Copy tất cả
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </Modal>
  );
}
