import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { EMPLOYEE_SORT_FIELDS, type EmployeeSortField } from '../constants/employee.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Query danh sách Employee.
 * Filter: fullname, email, status, department, startDate (từ ngày). Search: fullname/email/phone.
 */
export class EmployeeQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Lọc theo họ tên (chứa)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  fullname?: string;

  @ApiPropertyOptional({ description: 'Lọc theo email (chứa)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus, description: 'Lọc theo trạng thái' })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ description: 'Lọc theo phòng làm việc (chứa)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  department?: string;

  @ApiPropertyOptional({ description: 'Lọc nhân viên vào làm TỪ ngày này (ISO date)' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Lọc theo Role ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Tìm kiếm theo họ tên / email / SĐT' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: EMPLOYEE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(EMPLOYEE_SORT_FIELDS)
  sortBy?: EmployeeSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
