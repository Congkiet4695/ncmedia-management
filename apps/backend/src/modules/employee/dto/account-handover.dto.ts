import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeAccountHandoverType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ACCOUNT_HANDOVER_MAX_AMOUNT } from '../constants/account-handover.constants';
import { PaginationMetaDto } from './employee-response.dto';

/** PATCH /employees/:id/account-handover-amount — Admin đặt lại "Tiền giao account" (USD). */
export class UpdateAccountHandoverAmountDto {
  @ApiProperty({ example: 80, minimum: 0, description: 'Số dư mới (USD, tối đa 2 chữ số thập phân, không âm).' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(ACCOUNT_HANDOVER_MAX_AMOUNT)
  amount!: number;

  @ApiPropertyOptional({
    example: 40,
    description:
      'Số dư người dùng đang thấy khi mở form. Khác số dư thật (vừa có khoản cộng tự động) ⇒ 409 ' +
      'EMPLOYEE_ACCOUNT_HANDOVER_AMOUNT_CHANGED thay vì ghi đè.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(ACCOUNT_HANDOVER_MAX_AMOUNT)
  expectedAmount?: number;

  @ApiPropertyOptional({ maxLength: 500, description: 'Lý do chỉnh tay (lưu vào lịch sử).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AccountHandoverHistoryQueryDto {
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
}

/** Một biến động trong sổ cái "Tiền giao account". */
export class AccountHandoverTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: EmployeeAccountHandoverType }) type!: EmployeeAccountHandoverType;
  @ApiProperty({ description: 'Biến động có dấu (+ cộng, − trừ).' }) amount!: number;
  @ApiProperty() balanceBefore!: number;
  @ApiProperty() balanceAfter!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) tiktokAccountId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) tiktokAccountName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Người thực hiện thao tác.' })
  actorName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() createdAt!: string;
}

export class AccountHandoverTransactionPageDto {
  @ApiProperty({ type: AccountHandoverTransactionDto, isArray: true }) items!: AccountHandoverTransactionDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}
