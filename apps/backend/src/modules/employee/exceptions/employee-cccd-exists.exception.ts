import { ConflictException } from '@nestjs/common';

/** CCCD đã tồn tại (unique). */
export class EmployeeCccdExistsException extends ConflictException {
  constructor() {
    super({ code: 'EMPLOYEE_CCCD_EXISTS', message: 'CCCD đã tồn tại' });
  }
}
