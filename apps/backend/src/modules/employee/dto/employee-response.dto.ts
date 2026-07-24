import { ApiProperty } from '@nestjs/swagger';

/** Role rút gọn trong hồ sơ Employee. `name` = display name của Role. */
export class EmployeeRoleDto {
  @ApiProperty({ example: '7b5f...' }) id!: string;
  @ApiProperty({ example: 'EMPLOYEE' }) code!: string;
  @ApiProperty({ example: 'Employee' }) name!: string;
}

/**
 * Hồ sơ Employee đầy đủ (GET /:id, create/update).
 * fullName/email/role lấy từ User; status là EmployeeStatus. KHÔNG lộ passwordHash.
 */
export class EmployeeResponseDto {
  @ApiProperty({ example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' }) id!: string;
  @ApiProperty({ example: 'Nguyen Van A' }) fullName!: string;
  @ApiProperty({ example: 'employee@ncmedia.com' }) email!: string;
  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'RESIGNED', 'SUSPENDED'] })
  status!: string;
  @ApiProperty({ nullable: true, type: String, example: 'lark.nguyenvana' }) larkAccount!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '2024-01-15' }) startDate!: string | null;
  @ApiProperty({ nullable: true, type: String, example: null }) resignedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '012345678901' }) cccd!: string | null;
  @ApiProperty({ nullable: true, type: String, example: null }) cccdImageUrl!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '0901234567' }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '1990-01-15' }) dateOfBirth!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Hà Nội' }) address!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Kinh doanh' }) department!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '0123456789' }) bankAccount!: string | null;
  @ApiProperty({ nullable: true, type: String, example: null }) bankQrUrl!: string | null;
  @ApiProperty({ example: 0, description: 'Lương (VND)' }) salary!: number;
  @ApiProperty({ example: 0, description: 'KPI Đơn hàng (mục tiêu/tháng)' }) orderKpi!: number;
  @ApiProperty({ example: 0, description: 'KPI Doanh thu (USD, mục tiêu/tháng)' }) revenueKpi!: number;
  @ApiProperty({ nullable: true, type: String, example: null }) avatar!: string | null;
  @ApiProperty({ type: EmployeeRoleDto }) role!: EmployeeRoleDto;
  @ApiProperty({ example: '2026-07-15T00:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-07-15T00:00:00.000Z' }) updatedAt!: string;
}

/**
 * Hàng danh sách (table) — chỉ field cần hiển thị:
 * Avatar, Tên, Email, SĐT, Phòng, Trạng thái, Ngày vào làm, Ngày nghỉ.
 */
export class EmployeeListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) department!: string | null;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty({ nullable: true, type: String }) startDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) resignedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) avatar!: string | null;
  @ApiProperty({ type: EmployeeRoleDto }) role!: EmployeeRoleDto;
  @ApiProperty() createdAt!: string;
}

/**
 * Thông tin đăng nhập khởi tạo — hiển thị **một lần** khi tạo Employee.
 * Không lưu plaintext; được redact trong log.
 */
export class EmployeeCredentialsDto {
  @ApiProperty({ example: 'employee@ncmedia.com' }) email!: string;
  @ApiProperty({ description: 'Mật khẩu khởi tạo (hiển thị một lần)' }) initialPassword!: string;
}

/** Response khi TẠO Employee — kèm `credentials` (email + initialPassword) hiển thị một lần. */
export class CreateEmployeeResponseDto extends EmployeeResponseDto {
  @ApiProperty({ type: EmployeeCredentialsDto }) credentials!: EmployeeCredentialsDto;
}

/** Response khi reset mật khẩu — mật khẩu mới hiển thị **một lần**. */
export class ResetPasswordResponseDto {
  @ApiProperty({ description: 'Mật khẩu mới (hiển thị một lần)' }) newPassword!: string;
}

/** Metadata phân trang (ADR-023). */
export class PaginationMetaDto {
  @ApiProperty({ example: 42 }) total!: number;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 3 }) totalPages!: number;
}

/** Danh sách Employee có phân trang (EmployeeListDto). */
export class PaginatedEmployeeResponseDto {
  @ApiProperty({ type: EmployeeListItemDto, isArray: true }) items!: EmployeeListItemDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}
