import type { PaginationMeta } from '@/types/api';

export type AccountStatus = 'NEW' | 'LIVE' | 'DIE_TRANG' | 'DIE' | 'RETURNED';

export interface AccountPlatform {
  id: string;
  code: string;
  name: string;
}

export interface AccountSeller {
  id: string;
  fullName: string;
  email: string;
}

/** Chi tiết Account (không secret). */
export interface Account {
  id: string;
  name: string;
  idNormalize: string | null;
  platform: AccountPlatform | null;
  loginTool: string | null;
  seller: AccountSeller | null;
  status: AccountStatus;
  issuedAt: string | null;
  activatedAt: string | null;
  diedBlankAt: string | null;
  diedAt: string | null;
  moneyReturnedAt: string | null;
  dieReason: string | null;
  lifespanDays: number | null;
  proxy: string | null;
  docsUrl: string | null;
  note: string | null;
  note2: string | null;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountListItem {
  id: string;
  name: string;
  platformName: string | null;
  sellerName: string | null;
  status: AccountStatus;
  issuedAt: string | null;
  diedAt: string | null;
  lifespanDays: number | null;
  hasCredentials: boolean;
  createdAt: string;
}

export interface AccountListResult {
  items: AccountListItem[];
  meta: PaginationMeta;
}

export interface AccountQuery {
  page?: number;
  limit?: number;
  search?: string;
  platformId?: string;
  status?: AccountStatus;
  sellerUserId?: string;
  issuedFrom?: string;
  issuedTo?: string;
  sortBy?: 'createdAt' | 'name' | 'status' | 'issuedAt' | 'diedAt';
  sortOrder?: 'asc' | 'desc';
}

/** Credentials (đã giải mã khi reveal, hoặc payload cập nhật). */
export interface AccountCredentials {
  inf: string | null;
  ssn: string | null;
  phoneReg: string | null;
  gmail: string | null;
  gmailPassword: string | null;
  recoveryMail: string | null;
  recoveryMail2fa: string | null;
  platformPassword: string | null;
  platform2faSecret: string | null;
}

export type CredentialsPayload = Partial<Record<keyof AccountCredentials, string>>;

export interface SellerOption {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface GroupCount {
  key: string | null;
  label: string;
  live: number;
  dieTrang: number;
  die: number;
  total: number;
}

export interface AccountOverview {
  total: number;
  byStatus: { live: number; dieTrang: number; die: number; total: number };
  bySeller: GroupCount[];
  byPlatform: GroupCount[];
}

export interface CreateAccountPayload {
  name: string;
  idNormalize?: string;
  platformId?: string;
  loginTool?: string;
  sellerUserId?: string;
  status?: AccountStatus;
  issuedAt?: string;
  activatedAt?: string;
  diedBlankAt?: string;
  diedAt?: string;
  moneyReturnedAt?: string;
  dieReason?: string;
  proxy?: string;
  docsUrl?: string;
  note?: string;
  note2?: string;
}

export type UpdateAccountPayload = Partial<CreateAccountPayload>;
