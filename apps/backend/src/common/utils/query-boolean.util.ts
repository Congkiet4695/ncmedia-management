/**
 * `@Transform` DUY NHẤT cho field boolean của DTO.
 *
 * 🔴 Đọc giá trị GỐC (`obj[key]`), không đọc `value`: `enableImplicitConversion` của ValidationPipe (main.ts) đã đổi chuỗi
 * "false" thành `true` (Boolean("false")) trước khi transform chạy, làm mọi `?flag=false` thành `true`.
 *
 * Giá trị khác `true`/`false` được giữ nguyên để `@IsBoolean` trả 400, không âm thầm thành một trong hai. Chuỗi rỗng
 * (`?flag=`) coi như không gửi.
 */
export const toBool = ({
  obj,
  key,
  value,
}: {
  obj?: Record<string, unknown>;
  key?: string;
  value?: unknown;
}): unknown => {
  const raw = obj && key !== undefined && key in obj ? obj[key] : value;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '') return undefined;
  return raw;
};
