/**
 * Kiểu dữ liệu domain Auth — khớp hợp đồng Backend (auth.md Mục 16).
 */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  status: string;
}

export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

/** Response của POST /auth/register (201). */
export interface RegisterResponse {
  organization: AuthOrganization;
  user: AuthUser;
  tokens: AuthTokens;
}

/** Response của POST /auth/login (200). */
export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
  organization?: AuthOrganization;
}

/** Payload thiết lập phiên đăng nhập cho store. */
export interface SessionPayload {
  user: AuthUser;
  organization?: AuthOrganization;
  tokens: AuthTokens;
}
