import { ApiProperty } from '@nestjs/swagger';

export class OrganizationSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
}

export class UserSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
  @ApiProperty({ example: 900, description: 'Access token TTL (giây)' }) expiresIn!: number;
}

export class RegisterResponseDto {
  @ApiProperty({ type: OrganizationSummaryDto }) organization!: OrganizationSummaryDto;
  @ApiProperty({ type: UserSummaryDto }) user!: UserSummaryDto;
  @ApiProperty({ type: AuthTokensDto }) tokens!: AuthTokensDto;
}
