import { NotFoundException } from '@nestjs/common';

/** Không tìm thấy Employee trong Organization hiện tại (hoặc đã soft-delete). */
export class EmployeeNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'EMPLOYEE_NOT_FOUND', message: 'Không tìm thấy nhân viên' });
  }
}
