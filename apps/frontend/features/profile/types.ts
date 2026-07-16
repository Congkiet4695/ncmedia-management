export interface ProfileRole {
  id: string;
  code: string;
  name: string;
}

export interface ProfileOrganization {
  id: string;
  name: string;
  slug: string;
}

/** Hồ sơ của chính người dùng đăng nhập (self-service). */
export interface Profile {
  id: string;
  email: string;
  fullName: string;
  status: string;
  role: ProfileRole;
  organization: ProfileOrganization;
  avatar: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  address: string | null;
  larkAccount: string | null;
  bankAccount: string | null;
  bankQrUrl: string | null;
  department: string | null;
  cccd: string | null;
  startDate: string | null;
  salary: number | null;
}

export interface UpdateProfileInput {
  fullName?: string;
  avatar?: string;
  phone?: string;
  dateOfBirth?: string;
  address?: string;
  larkAccount?: string;
  bankAccount?: string;
  bankQrUrl?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
