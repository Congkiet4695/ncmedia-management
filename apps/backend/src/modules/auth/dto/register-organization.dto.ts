import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

  @ApiProperty({ example: 'P@ssw0rd123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // giới hạn bcrypt
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password phải có ít nhất 1 chữ và 1 số',
  })
  password!: string;
}
