import { ConflictException } from '@nestjs/common';

/** Email đã tồn tại (email global unique — Decision-001). */
export class EmployeeEmailExistsException extends ConflictException {
  constructor() {
    super({ code: 'EMPLOYEE_EMAIL_EXISTS', message: 'Email đã tồn tại' });
  }
}
