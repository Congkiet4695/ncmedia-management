import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { EMPLOYEE_ORDER_KPI_MAX, EMPLOYEE_SALARY_MAX } from '../constants/employee.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const lowerTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Input tạo Employee (sheet "Nhân viên").
 * BR: email global unique, CCCD unique, password auto-generate, role mặc định EMPLOYEE, status mặc định ACTIVE.
 */
export class CreateEmployeeDto {
  @ApiProperty({ example: 'Nguyen Van A', minLength: 2, maxLength: 255, description: 'Tên (bắt buộc)' })
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;

  @ApiProperty({ example: 'employee@ncmedia.com', maxLength: 255, description: 'Email (global unique)' })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ enum: EmployeeStatus, default: EmployeeStatus.ACTIVE, description: 'Trạng thái nhân sự' })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ example: 'lark.nguyenvana', maxLength: 255, description: 'Account Lark' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  larkAccount?: string;

  @ApiPropertyOptional({ example: '2024-01-15', description: 'Ngày bắt đầu làm việc (ISO date)' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ example: null, description: 'Ngày nghỉ việc (ISO date)' })
  @IsOptional()
  @IsISO8601()
  resignedAt?: string;

  @ApiPropertyOptional({ example: '012345678901', maxLength: 20, description: 'CCCD (unique, 9–12 số)' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{9,12}$/, { message: 'CCCD phải gồm 9–12 chữ số' })
  cccd?: string;

  @ApiPropertyOptional({ maxLength: 1024, description: 'URL ảnh CCCD' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cccdImageUrl?: string;

  @ApiPropertyOptional({ example: '0901234567', maxLength: 20, description: 'Số điện thoại' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^[0-9+\-\s]{8,20}$/, { message: 'Số điện thoại không hợp lệ' })
  phone?: string;

  @ApiPropertyOptional({ example: '1990-01-15', description: 'Ngày sinh (ISO date)' })
  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Địa chỉ' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'Kinh doanh', maxLength: 255, description: 'Phòng làm việc' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  department?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Tài khoản ngân hàng' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  bankAccount?: string;

  @ApiPropertyOptional({ maxLength: 1024, description: 'URL QR ngân hàng' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  bankQrUrl?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0, default: 0, description: 'Lương (VND), >= 0' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(EMPLOYEE_SALARY_MAX)
  salary?: number;

  @ApiPropertyOptional({ example: 0, minimum: 0, default: 0, description: 'KPI Đơn hàng (mục tiêu/tháng), số nguyên >= 0' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(EMPLOYEE_ORDER_KPI_MAX)
  orderKpi?: number;

  @ApiPropertyOptional({ example: 0, minimum: 0, default: 0, description: 'KPI Doanh thu (USD, mục tiêu/tháng), >= 0' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(EMPLOYEE_SALARY_MAX)
  revenueKpi?: number;

  @ApiPropertyOptional({ maxLength: 1024, description: 'URL avatar' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  avatar?: string;

  @ApiPropertyOptional({ description: 'Role ID (bỏ trống → mặc định EMPLOYEE)', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
