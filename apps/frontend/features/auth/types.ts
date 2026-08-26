/**
 * Kiểu dữ liệu domain Auth — khớp hợp đồng Backend (auth.md Mục 16, login.md).
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

/**
 * Response của POST /auth/register (201).
 *
 * 🔴 KHÔNG có `tokens`. Organization mới đăng ký ở trạng thái PENDING và phải chờ Super Admin
 * duyệt — phát token ở đây là mở cửa sau cho đúng thứ luồng duyệt sinh ra để chặn.
 */
export interface RegisterResponse {
  organization: AuthOrganization;
  user: AuthUser;
  /** Email xác nhận đã gửi được chưa. `false` ⇒ đăng ký VẪN thành công. */
  emailSent: boolean;
}

/** Response của POST /auth/login (200). */
export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
  organization?: AuthOrganization;
}

// --- GET /auth/me ---------------------------------------------------------

export interface MeRole {
  id: string;
  code: string;
  name: string;
}

export interface MeOrganization {
  id: string;
  name: string;
  slug: string;
}

/** Phần "user" trong hồ sơ /me (avatar/dateOfBirth là Employee field — null ở Sprint 1). */
export interface MeUser {
  id: string;
  email: string;
  fullName: string;
  avatar: string | null;
  dateOfBirth: string | null;
}

/** Response đầy đủ của GET /auth/me. */
export interface MeProfile extends MeUser {
  organization: MeOrganization;
  role: MeRole;
  /** Mã permission `resource.action` của Role — để render UI/sidebar theo quyền. */
  permissions: string[];
}
