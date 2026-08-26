'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AuthCard } from './auth-card';
import { RegisterForm } from './register-form';

/** Kết quả đăng ký cần giữ lại để hiển thị màn "chờ duyệt". */
export interface RegisterOutcome {
  email: string;
  emailSent: boolean;
}

/**
 * Khung màn hình Đăng ký — đổi HẲN nội dung sau khi gửi thành công.
 *
 * ```
 *   [form đăng ký]  ──submit──▶  [đã tiếp nhận · chờ Super Admin duyệt]
 * ```
 *
 * 🔴 Tồn tại để **tiêu đề của thẻ cũng đổi theo**. Nếu chỉ đổi phần thân bên trong thì người
 * dùng đọc được "Tạo tài khoản" ngay phía trên dòng "Đã tiếp nhận đăng ký" — hai câu mâu
 * thuẫn nhau ở đúng thời điểm họ cần hiểu rõ nhất chuyện gì vừa xảy ra.
 *
 * Trang `/register` là Server Component (cần `metadata`), nên trạng thái này phải nằm ở một
 * client component riêng thay vì ở chính trang.
 */
export function RegisterPanel() {
  const { t } = useTranslation('auth');
  const [outcome, setOutcome] = useState<RegisterOutcome | null>(null);

  if (!outcome) {
    return (
      <AuthCard titleKey="register.title" descriptionKey="register.subtitle">
        <RegisterForm onSubmitted={setOutcome} />
      </AuthCard>
    );
  }

  return (
    <AuthCard titleKey="register.pendingTitle" descriptionKey="register.pendingBody">
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <MailCheck className="size-6" />
        </div>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          {/* Nói thật về việc email có gửi được hay không — người dùng sẽ đi tìm nó trong hộp
              thư, và im lặng khi SMTP hỏng là để họ chờ một email không bao giờ tới. */}
          {outcome.emailSent ? (
            <p className="text-muted-foreground">
              {t('register.pendingEmailSent', { email: outcome.email })}
            </p>
          ) : (
            <p className="text-amber-600">{t('register.pendingEmailFailed')}</p>
          )}
        </div>

        <Button asChild className="w-full">
          <Link href="/login">{t('register.backToLogin')}</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
