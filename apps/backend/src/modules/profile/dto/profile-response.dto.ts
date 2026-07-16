import { ApiProperty } from '@nestjs/swagger';

/** Role rút gọn (read-only). */
export class ProfileRoleDto {
  @ApiProperty({ example: '7b5f...' }) id!: string;
  @ApiProperty({ example: 'EMPLOYEE' }) code!: string;
  @ApiProperty({ example: 'Employee' }) name!: string;
}

/** Organization rút gọn (read-only). */
export class ProfileOrganizationDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

/**
 * Hồ sơ của chính người dùng đăng nhập (self-service).
 * `role`, `status`, `organization`, `department`, `salary`, `startDate`, `cccd` là **read-only**.
 * KHÔNG lộ passwordHash.
 */
export class ProfileResponseDto {
  @ApiProperty({ description: 'User ID' }) id!: string;
  @ApiProperty({ example: 'employee@ncmedia.com' }) email!: string;
  @ApiProperty({ example: 'Nguyen Van A' }) fullName!: string;
  @ApiProperty({ example: 'ACTIVE', description: 'Read-only' }) status!: string;
  @ApiProperty({ type: ProfileRoleDto, description: 'Read-only' }) role!: ProfileRoleDto;
  @ApiProperty({ type: ProfileOrganizationDto, description: 'Read-only' })
  organization!: ProfileOrganizationDto;

  // --- Thông tin cá nhân (từ Employee nếu có) ---
  @ApiProperty({ nullable: true, type: String }) avatar!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '1990-01-15' }) dateOfBirth!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({ nullable: true, type: String }) larkAccount!: string | null;
  @ApiProperty({ nullable: true, type: String }) bankAccount!: string | null;
  @ApiProperty({ nullable: true, type: String }) bankQrUrl!: string | null;

  // --- Read-only (do HR/Admin quản lý) ---
  @ApiProperty({ nullable: true, type: String, description: 'Read-only' }) department!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Read-only' }) cccd!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Read-only' }) startDate!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Read-only' }) salary!: number | null;
}
