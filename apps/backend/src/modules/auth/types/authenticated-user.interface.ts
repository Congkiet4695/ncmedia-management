/**
 * Thông tin người dùng đã xác thực, trích từ Access Token (JWT payload) bởi JwtAuthGuard.
 * Nguồn tenant context: `organizationId` — luôn lấy từ token phía server (ADR-004).
 */
export interface AuthenticatedUser {
  userId: string; // payload.sub
  organizationId: string;
  role: string; // role code
  jti: string;
  /**
   * Permission của Role người dùng, do `PermissionsGuard` gắn vào sau khi nạp.
   *
   * 🔴 Chỉ có mặt khi route ĐI QUA `PermissionsGuard` (tức có `@RequirePermissions`). Guard
   * đằng nào cũng phải nạp danh sách này để quyết định cho qua hay không; giữ lại giúp
   * controller khỏi hỏi database lần thứ hai chỉ để trả lời "người này còn làm được gì nữa".
   * KHÔNG nhúng vào JWT (login.md Mục 9) — quyền phải đọc lại mỗi request để việc thu hồi
   * có hiệu lực ngay.
   */
  permissions?: string[];
}
