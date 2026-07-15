import { ApiProperty } from '@nestjs/swagger';

/**
 * Thông tin User trả về sau Login (login.md Mục 11.1).
 * KHÔNG chứa password_hash hay PII thừa (BR-L02, Mục 14).
 */
export class LoginUserDto {
  @ApiProperty({ example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' }) id!: string;
  @ApiProperty({ example: 'admin@ncmedia.com' }) email!: string;
  @ApiProperty({ example: 'Nguyen Van A' }) fullName!: string;
  @ApiProperty({ example: 'b1c2d3e4-0000-4a00-8000-000000000001' }) organizationId!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty({ example: 'ADMIN', description: 'Mã Role đơn của User (Decision-007)' }) role!: string;
}

/** Cặp token cấp khi Login (login.md Mục 9). */
export class LoginTokensDto {
  @ApiProperty({ description: 'JWT Access Token (HS256, TTL 15 phút)' }) accessToken!: string;
  @ApiProperty({ description: 'JWT Refresh Token (HS256, TTL 7 ngày)' }) refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
  @ApiProperty({ example: 900, description: 'Access token TTL (giây)' }) expiresIn!: number;
}

/** Response chuẩn cho POST /auth/login (login.md Mục 11.1). */
export class LoginResponseDto {
  @ApiProperty({ type: LoginUserDto }) user!: LoginUserDto;
  @ApiProperty({ type: LoginTokensDto }) tokens!: LoginTokensDto;
}
