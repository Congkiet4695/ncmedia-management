import { ApiProperty } from '@nestjs/swagger';

/** Tổ chức (tenant) của người dùng — chỉ trường công khai. */
export class MeOrganizationDto {
  @ApiProperty({ example: 'b1c2d3e4-0000-4a00-8000-000000000001' }) id!: string;
  @ApiProperty({ example: 'NCMedia Co.' }) name!: string;
  @ApiProperty({ example: 'ncmedia-co' }) slug!: string;
}

/** Role đơn của người dùng (Decision-007). `name` = display name của Role. */
export class MeRoleDto {
  @ApiProperty({ example: '7b5f...' }) id!: string;
  @ApiProperty({ example: 'ADMIN' }) code!: string;
  @ApiProperty({ example: 'Administrator' }) name!: string;
}

/**
 * Response cho GET /auth/me.
 *
 * KHÔNG trả: passwordHash, failedLoginCount, lockedUntil, refreshToken, deletedAt, permissions.
 *
 * `avatar` và `dateOfBirth` thuộc hồ sơ **Employee** (ADR-007) — Employee CHƯA có ở Sprint 1,
 * nên luôn `null`. Giữ trong contract để Frontend ổn định; sẽ có giá trị khi module Employee ra đời.
 */
export class MeResponseDto {
  @ApiProperty({ example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' }) id!: string;
  @ApiProperty({ example: 'admin@ncmedia.com' }) email!: string;
  @ApiProperty({ example: 'Nguyen Van A' }) fullName!: string;
  @ApiProperty({ nullable: true, type: String, example: null, description: 'Employee field (ADR-007) — null ở Sprint 1' })
  avatar!: string | null;
  @ApiProperty({ nullable: true, type: String, example: null, description: 'Employee field (ADR-007) — null ở Sprint 1' })
  dateOfBirth!: string | null;
  @ApiProperty({ type: MeOrganizationDto }) organization!: MeOrganizationDto;
  @ApiProperty({ type: MeRoleDto }) role!: MeRoleDto;
}
