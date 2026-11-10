import { ApiProperty } from '@nestjs/swagger';

/** Tổ chức (tenant) của người dùng — chỉ trường công khai. */
export class MeOrganizationDto {
  @ApiProperty({ example: 'b1c2d3e4-0000-4a00-8000-000000000001' }) id!: string;
  @ApiProperty({ example: 'NCMedia Co.' }) name!: string;
  @ApiProperty({ example: 'ncmedia-co' }) slug!: string;
  /**
   * Gói sử dụng — hiển thị ở header của Admin / Employee. `null` với tổ chức hệ thống (Super Admin): không
   * giới hạn Shop, không hết hạn.
   */
  @ApiProperty({ type: () => MeOrganizationPlanDto, nullable: true }) plan!: MeOrganizationPlanDto | null;
}

/** Giới hạn Shop + thời hạn của tổ chức (docs/organization-lifecycle.md). */
export class MeOrganizationPlanDto {
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty({ example: 3, description: 'Shop TikTok đang kết nối (đã liên kết, chưa gỡ)' })
  connectedShopCount!: number;
  @ApiProperty({ nullable: true, type: Number, example: 10, description: 'NULL = không giới hạn' })
  shopLimit!: number | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-12-01T00:00:00.000Z', description: 'NULL = không hết hạn' })
  expiresAt!: string | null;
  @ApiProperty({ example: false, description: 'now() >= expiresAt' }) expired!: boolean;
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
 * KHÔNG trả: passwordHash, failedLoginCount, lockedUntil, refreshToken, deletedAt.
 * Trả `permissions[]` (mã `resource.action` của Role) để Frontend render UI/sidebar theo quyền.
 *
 * `avatar` và `dateOfBirth` thuộc hồ sơ **Employee** (ADR-007) — luôn `null` (contract ổn định).
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
  @ApiProperty({ type: String, isArray: true, example: ['account.read', 'order.read'] })
  permissions!: string[];
}
