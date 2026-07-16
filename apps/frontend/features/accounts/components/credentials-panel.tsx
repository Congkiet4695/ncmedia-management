'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage } from '@/utils/http';
import { credentialsFormSchema, type CredentialsFormInput } from '../schemas/account.schema';
import { useUpdateCredentials } from '../hooks/use-accounts';
import { accountService } from '../services/account.service';
import type { CredentialsPayload } from '../types';

const FIELDS: { key: keyof CredentialsFormInput; label: string }[] = [
  { key: 'gmail', label: 'Gmail' },
  { key: 'gmailPassword', label: 'Pass Gmail' },
  { key: 'recoveryMail', label: 'Mail khôi phục' },
  { key: 'recoveryMail2fa', label: '2FA mail khôi phục' },
  { key: 'platformPassword', label: 'Pass nền tảng' },
  { key: 'platform2faSecret', label: '2FA nền tảng' },
  { key: 'ssn', label: 'SSN' },
  { key: 'inf', label: 'INF' },
  { key: 'phoneReg', label: 'Phone reg' },
];

const EMPTY: CredentialsFormInput = {
  inf: '',
  ssn: '',
  phoneReg: '',
  gmail: '',
  gmailPassword: '',
  recoveryMail: '',
  recoveryMail2fa: '',
  platformPassword: '',
  platform2faSecret: '',
};

export function CredentialsPanel({ accountId }: { accountId: string }) {
  const mutation = useUpdateCredentials();
  const [revealing, setRevealing] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CredentialsFormInput>({
    resolver: zodResolver(credentialsFormSchema),
    defaultValues: EMPTY,
  });

  const handleReveal = async () => {
    setRevealing(true);
    try {
      const data = await accountService.revealCredentials(accountId);
      reset({
        inf: data.inf ?? '',
        ssn: data.ssn ?? '',
        phoneReg: data.phoneReg ?? '',
        gmail: data.gmail ?? '',
        gmailPassword: data.gmailPassword ?? '',
        recoveryMail: data.recoveryMail ?? '',
        recoveryMail2fa: data.recoveryMail2fa ?? '',
        platformPassword: data.platformPassword ?? '',
        platform2faSecret: data.platform2faSecret ?? '',
      });
      toast.success('Đã hiển thị credentials (đã ghi audit)');
    } catch (error) {
      toast.error('Không reveal được', { description: getApiErrorMessage(error) });
    } finally {
      setRevealing(false);
    }
  };

  const onSubmit = async (values: CredentialsFormInput) => {
    const payload: CredentialsPayload = {};
    for (const { key } of FIELDS) {
      const v = values[key];
      if (v) payload[key] = v;
    }
    if (Object.keys(payload).length === 0) {
      toast.error('Chưa nhập giá trị nào để cập nhật');
      return;
    }
    try {
      await mutation.mutateAsync({ id: accountId, payload });
      toast.success('Đã cập nhật credentials');
    } catch (error) {
      toast.error('Cập nhật thất bại', { description: getApiErrorMessage(error) });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Dữ liệu nhạy cảm (mã hoá at-rest). Mỗi lần &quot;Hiển thị&quot; đều được ghi log audit. Để
          trống = giữ nguyên; nhập giá trị mới để cập nhật.
        </span>
      </div>

      <Button type="button" variant="outline" onClick={handleReveal} disabled={revealing}>
        {revealing ? <Loader2 className="animate-spin" /> : <Eye className="size-4" />}
        Hiển thị giá trị hiện tại
      </Button>

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
            <Input id={`cred-${f.key}`} autoComplete="off" disabled={mutation.isPending} {...register(f.key)} />
            {errors[f.key] && <p className="text-sm text-destructive">{errors[f.key]?.message}</p>}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Lưu credentials
        </Button>
      </div>
    </form>
  );
}
