import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Input cho Login (login.md Mục 6/13).
 * Validation:
 *   - email: bắt buộc, đúng định dạng, ≤ 255, normalize lowercase + trim.
 *   - password: bắt buộc, string non-empty (KHÔNG áp policy phức tạp ở Login — login.md Mục 6).
 */
export class LoginRequestDto {
  @ApiProperty({
    example: 'admin@ncmedia.com',
    maxLength: 255,
    description: 'Email đăng nhập (được chuẩn hóa lowercase + trim)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'P@ssw0rd123', description: 'Mật khẩu (không để trống)' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
