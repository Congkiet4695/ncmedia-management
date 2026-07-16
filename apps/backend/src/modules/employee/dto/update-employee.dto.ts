import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/**
 * Input cập nhật Employee.
 * - Bỏ `email` (định danh tài khoản — không cho đổi ở phạm vi này).
 * - `organizationId` không bao giờ có trong input (BR: Admin không sửa Organization).
 * - Tất cả field còn lại optional.
 */
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['email'] as const),
) {}
