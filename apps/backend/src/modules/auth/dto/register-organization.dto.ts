import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Input cho Register Organization (auth.md Mục 6/17).
 * Validation: Decision-002 (password ≥8, có chữ + số).
 */
export class RegisterOrganizationDto {
  @ApiProperty({ example: 'NCMedia Co.', minLength: 2, maxLength: 255 })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(255)
  organizationName!: string;

  @ApiProperty({ example: 'Nguyen Van A', minLength: 2, maxLength: 255 })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;

  @ApiProperty({ example: 'admin@ncmedia.com', maxLength: 255 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  /**
   * Số điện thoại liên hệ — TUỲ CHỌN.
   *
   * Super Admin dùng để xác minh trước khi duyệt. Không bắt buộc: thêm một trường bắt buộc
   * vào form đăng ký là thêm một lý do để người dùng bỏ dở.
   */
  @ApiPropertyOptional({ example: '0912345678', maxLength: 20 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  @IsString()
  @MaxLength(20)
  @Matches(/^[0-9+()\s-]{6,20}$/, { message: 'phone không hợp lệ' })
  phone?: string;

  @ApiProperty({ example: 'P@ssw0rd123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // giới hạn bcrypt
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password phải có ít nhất 1 chữ và 1 số',
  })
  password!: string;
}
