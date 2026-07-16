import { z } from 'zod';

export const ACCOUNT_STATUSES = ['NEW', 'LIVE', 'DIE_TRANG', 'DIE', 'RETURNED'] as const;

export const ACCOUNT_STATUS_LABELS: Record<(typeof ACCOUNT_STATUSES)[number], string> = {
  NEW: 'Mới',
  LIVE: 'Live',
  DIE_TRANG: 'Die trắng',
  DIE: 'Die',
  RETURNED: 'Đã về tiền',
};

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ')
  .or(z.literal(''));

/** Form Account (khớp Create/UpdateAccountDto backend). Không gồm credentials. */
export const accountFormSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên').max(255, 'Tối đa 255 ký tự'),
  idNormalize: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, 'Chỉ gồm chữ, số, gạch ngang')
    .max(120)
    .or(z.literal('')),
  platformId: z.string().uuid('Platform không hợp lệ').or(z.literal('')),
  loginTool: z.string().max(100).or(z.literal('')),
  sellerUserId: z.string().uuid('Seller không hợp lệ').or(z.literal('')),
  status: z.enum(ACCOUNT_STATUSES),
  issuedAt: optionalDate,
  activatedAt: optionalDate,
  diedBlankAt: optionalDate,
  diedAt: optionalDate,
  moneyReturnedAt: optionalDate,
  dieReason: z.string().max(2000).or(z.literal('')),
  proxy: z.string().max(255).or(z.literal('')),
  docsUrl: z.string().max(1024).or(z.literal('')),
  note: z.string().max(2000).or(z.literal('')),
  note2: z.string().max(2000).or(z.literal('')),
});

export type AccountFormInput = z.infer<typeof accountFormSchema>;

/** Form credentials (mọi field optional; để trống = giữ nguyên). */
export const credentialsFormSchema = z.object({
  inf: z.string().max(1024).or(z.literal('')),
  ssn: z.string().max(64).or(z.literal('')),
  phoneReg: z.string().max(64).or(z.literal('')),
  gmail: z.string().max(255).or(z.literal('')),
  gmailPassword: z.string().max(255).or(z.literal('')),
  recoveryMail: z.string().max(255).or(z.literal('')),
  recoveryMail2fa: z.string().max(255).or(z.literal('')),
  platformPassword: z.string().max(255).or(z.literal('')),
  platform2faSecret: z.string().max(255).or(z.literal('')),
});

export type CredentialsFormInput = z.infer<typeof credentialsFormSchema>;
