import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Input credentials/định danh của Account (🔒 mã hoá at-rest — docs/account.md D-01).
 * Tất cả optional. KHÔNG bao giờ trả về ở GET/list — chỉ qua endpoint reveal.
 */
export class CredentialsInputDto {
  @ApiPropertyOptional({ description: 'Chuỗi định danh INF' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  inf?: string;

  @ApiPropertyOptional({ description: 'SSN' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ssn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phoneReg?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  gmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  gmailPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  recoveryMail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  recoveryMail2fa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platformPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  platform2faSecret?: string;
}
