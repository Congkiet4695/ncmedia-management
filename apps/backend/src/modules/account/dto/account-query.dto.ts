import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AccountStatus } from '@prisma/client';
import { ACCOUNT_SORT_FIELDS, type AccountSortField } from '../constants/account.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Query danh sách Account: filter/search/sort/pagination. */
export class AccountQueryDto {
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

  @ApiPropertyOptional({ description: 'Tìm theo tên / ID chuẩn hoá' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  platformId?: string;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sellerUserId?: string;

  @ApiPropertyOptional({ description: 'Ngày cấp từ (ISO date)' })
  @IsOptional()
  @IsISO8601()
  issuedFrom?: string;

  @ApiPropertyOptional({ description: 'Ngày cấp đến (ISO date)' })
  @IsOptional()
  @IsISO8601()
  issuedTo?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ACCOUNT_SORT_FIELDS)
  sortBy?: AccountSortField = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
