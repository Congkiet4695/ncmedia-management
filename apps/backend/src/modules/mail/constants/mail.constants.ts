/**
 * Hằng số Mail Module.
 *
 * 🔴 KHÔNG có địa chỉ SMTP, tài khoản hay mật khẩu nào ở đây — toàn bộ đến từ ENV qua
 * `ConfigService` (ADR-020: không hardcode). File này chỉ chứa danh mục template và tiêu đề.
 */

/**
 * Template email của hệ thống.
 *
 * Giá trị chính là TÊN FILE trong `templates/` (không kèm đuôi). Khai báo thành enum thay vì
 * truyền chuỗi tự do: gõ sai tên file thì lỗi biên dịch, không phải một email im lặng không
 * bao giờ gửi được.
 */
export const MAIL_TEMPLATE = {
  ORGANIZATION_REGISTERED: 'organization-registered',
  ORGANIZATION_APPROVED: 'organization-approved',
  ORGANIZATION_REJECTED: 'organization-rejected',
} as const;
export type MailTemplateName = (typeof MAIL_TEMPLATE)[keyof typeof MAIL_TEMPLATE];

/** Tiêu đề email — đúng theo yêu cầu nghiệp vụ §3, §8, §9. */
export const MAIL_SUBJECT: Record<MailTemplateName, string> = {
  [MAIL_TEMPLATE.ORGANIZATION_REGISTERED]: 'Organization Registration Received',
  [MAIL_TEMPLATE.ORGANIZATION_APPROVED]: 'Organization Approved',
  [MAIL_TEMPLATE.ORGANIZATION_REJECTED]: 'Organization Registration Rejected',
};

/**
 * Cú pháp token trong template: `{{TOKEN}}`.
 *
 * Cố ý KHÔNG dùng một template engine đầy đủ (Handlebars/EJS): email hệ thống chỉ cần thay
 * chuỗi, còn một engine cho phép biểu thức là thêm một bề mặt tấn công vào thứ được gửi ra
 * ngoài hệ thống.
 */
export const MAIL_TOKEN_PATTERN = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

/** Timeout cho một lần gửi — SMTP treo không được phép giữ request đăng ký lại. */
export const MAIL_SEND_TIMEOUT_MS = 15_000;
