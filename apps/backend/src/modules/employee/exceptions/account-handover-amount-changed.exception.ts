import { ConflictException } from '@nestjs/common';

/**
 * Số dư "Tiền giao account" đã đổi kể từ lúc người dùng mở form (vd vừa có khoản cộng tự động) — từ chối ghi
 * đè để không làm mất cập nhật; người dùng tải lại rồi sửa tiếp.
 */
export class AccountHandoverAmountChangedException extends ConflictException {
  constructor() {
    super({
      code: 'EMPLOYEE_ACCOUNT_HANDOVER_AMOUNT_CHANGED',
      message: 'Tiền giao account vừa thay đổi. Vui lòng tải lại trước khi chỉnh sửa.',
    });
  }
}
