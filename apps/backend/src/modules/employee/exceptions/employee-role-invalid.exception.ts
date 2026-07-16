import { BadRequestException } from '@nestjs/common';

/** Role không hợp lệ: roleId không thuộc Organization, hoặc thiếu Role EMPLOYEE mặc định. */
export class EmployeeRoleInvalidException extends BadRequestException {
  constructor() {
    super({ code: 'EMPLOYEE_ROLE_INVALID', message: 'Role không hợp lệ trong tổ chức' });
  }
}
