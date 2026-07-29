import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AccountStatus } from '@prisma/client';
import {
  ACCOUNT_AMOUNT_DECIMALS,
  ACCOUNT_AMOUNT_MAX,
} from '../constants/account.constants';
import { CredentialsInputDto } from './credentials-input.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Input tạo Account (docs/account.md). Secret truyền qua `credentials` (mã hoá). */
export class CreateAccountDto {
  @ApiProperty({ example: 'TTS 32 - T3', minLength: 1, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Platform ID' })
  @IsOptional()
  @IsUUID()
  platformId?: string;

  @ApiPropertyOptional({ example: 'Hidemyacc', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  loginTool?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Seller (User) quản lý' })
  @IsOptional()
  @IsUUID()
  sellerUserId?: string;

  @ApiPropertyOptional({ enum: AccountStatus, default: AccountStatus.NEW })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ example: '2026-03-10', description: 'Ngày cấp (ISO date)' })
  @IsOptional()
  @IsISO8601()
  issuedAt?: string;

  @ApiPropertyOptional({ description: 'Ngày hoạt động (ISO date)' })
  @IsOptional()
  @IsISO8601()
  activatedAt?: string;

  @ApiPropertyOptional({ description: 'Ngày die trắng (ISO date)' })
  @IsOptional()
  @IsISO8601()
  diedBlankAt?: string;

  @ApiPropertyOptional({ description: 'Ngày die (ISO date)' })
  @IsOptional()
  @IsISO8601()
  diedAt?: string;

  @ApiPropertyOptional({ description: 'Ngày về tiền (ISO date)' })
  @IsOptional()
  @IsISO8601()
  moneyReturnedAt?: string;

  @ApiPropertyOptional({ description: 'Lý do die' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dieReason?: string;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    maximum: ACCOUNT_AMOUNT_MAX,
    default: 0,
    description: 'Hold — số dư sàn đang giữ (USD), >= 0, tối đa 2 số lẻ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: ACCOUNT_AMOUNT_DECIMALS })
  @Min(0)
  @Max(ACCOUNT_AMOUNT_MAX)
  holdAmount?: number;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    maximum: ACCOUNT_AMOUNT_MAX,
    default: 0,
    description: 'Net — số dư thực nhận (USD), >= 0, tối đa 2 số lẻ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: ACCOUNT_AMOUNT_DECIMALS })
  @Min(0)
  @Max(ACCOUNT_AMOUNT_MAX)
  netAmount?: number;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    maximum: ACCOUNT_AMOUNT_MAX,
    default: 0,
    description: 'Paid — số tiền đã thanh toán/đã rút (USD), >= 0, tối đa 2 số lẻ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: ACCOUNT_AMOUNT_DECIMALS })
  @Min(0)
  @Max(ACCOUNT_AMOUNT_MAX)
  paidAmount?: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  proxy?: string;

  @ApiPropertyOptional({ maxLength: 1024, description: 'Link giấy tờ (Docs)' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  docsUrl?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note2?: string;

  @ApiPropertyOptional({ type: CredentialsInputDto, description: '🔒 Credentials (mã hoá)' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CredentialsInputDto)
  credentials?: CredentialsInputDto;
}
