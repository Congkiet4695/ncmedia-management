/**
 * Thông tin người dùng đã xác thực, trích từ Access Token (JWT payload) bởi JwtAuthGuard.
 * Nguồn tenant context: `organizationId` — luôn lấy từ token phía server (ADR-004).
 */
export interface AuthenticatedUser {
  userId: string; // payload.sub
  organizationId: string;
  role: string; // role code
  jti: string;
}
