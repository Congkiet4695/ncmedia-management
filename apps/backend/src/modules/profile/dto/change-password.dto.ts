import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Input đổi mật khẩu của chính mình (Decision-002: ≥8, có chữ + số).
 * Khớp `confirmPassword` và khác `currentPassword` được kiểm tra ở service.
 */
export class ChangePasswordDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'NewP@ssw0rd', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'Mật khẩu phải có ít nhất 1 chữ và 1 số' })
  newPassword!: string;

  @ApiProperty({ description: 'Nhập lại mật khẩu mới' })
  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}
