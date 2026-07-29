import { ApiProperty } from '@nestjs/swagger';

export class AccountPlatformDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class AccountSellerDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() email!: string;
}

/** Chi tiết Account — KHÔNG chứa secret (chỉ cờ `hasCredentials`). */
export class AccountResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: AccountPlatformDto }) platform!: AccountPlatformDto | null;
  @ApiProperty({ nullable: true, type: String }) loginTool!: string | null;
  @ApiProperty({ nullable: true, type: AccountSellerDto }) seller!: AccountSellerDto | null;
  @ApiProperty({ example: 'NEW' }) status!: string;
  @ApiProperty({ nullable: true, type: String }) issuedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) activatedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) diedBlankAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) diedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) moneyReturnedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) dieReason!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Tuổi thọ (ngày) — derived' })
  lifespanDays!: number | null;
  @ApiProperty({ example: 0, description: 'Hold — số dư sàn đang giữ (USD)' }) holdAmount!: number;
  @ApiProperty({ example: 0, description: 'Net — số dư thực nhận (USD)' }) netAmount!: number;
  @ApiProperty({ example: 0, description: 'Paid — đã thanh toán/đã rút (USD)' }) paidAmount!: number;
  @ApiProperty({ nullable: true, type: String }) proxy!: string | null;
  @ApiProperty({ nullable: true, type: String }) docsUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: String }) note2!: string | null;
  @ApiProperty({ description: 'Có credentials đã lưu hay chưa' }) hasCredentials!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** Hàng danh sách Account. */
export class AccountListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) platformName!: string | null;
  @ApiProperty({ nullable: true, type: String }) sellerName!: string | null;
  @ApiProperty({ example: 'NEW' }) status!: string;
  @ApiProperty({ nullable: true, type: String }) issuedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) diedAt!: string | null;
  @ApiProperty({ nullable: true, type: Number }) lifespanDays!: number | null;
  @ApiProperty({ example: 0, description: 'Hold (USD)' }) holdAmount!: number;
  @ApiProperty({ example: 0, description: 'Net (USD)' }) netAmount!: number;
  @ApiProperty({ example: 0, description: 'Paid (USD)' }) paidAmount!: number;
  @ApiProperty() hasCredentials!: boolean;
  @ApiProperty() createdAt!: string;
}

/** Reveal credentials (đã giải mã) — chỉ trả qua endpoint riêng có permission + audit. */
export class CredentialsResponseDto {
  @ApiProperty({ nullable: true, type: String }) inf!: string | null;
  @ApiProperty({ nullable: true, type: String }) ssn!: string | null;
  @ApiProperty({ nullable: true, type: String }) phoneReg!: string | null;
  @ApiProperty({ nullable: true, type: String }) gmail!: string | null;
  @ApiProperty({ nullable: true, type: String }) gmailPassword!: string | null;
  @ApiProperty({ nullable: true, type: String }) recoveryMail!: string | null;
  @ApiProperty({ nullable: true, type: String }) recoveryMail2fa!: string | null;
  @ApiProperty({ nullable: true, type: String }) platformPassword!: string | null;
  @ApiProperty({ nullable: true, type: String }) platform2faSecret!: string | null;
}

/** Người dùng có thể gán làm Seller (selector). */
export class SellerOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() email!: string;
  @ApiProperty() role!: string;
}

export class PaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class PaginatedAccountResponseDto {
  @ApiProperty({ type: AccountListItemDto, isArray: true }) items!: AccountListItemDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta!: PaginationMetaDto;
}

// --- Overview (Tổng quan account) ---
export class AccountStatusCountDto {
  @ApiProperty() live!: number;
  @ApiProperty() dieTrang!: number;
  @ApiProperty() die!: number;
  @ApiProperty() total!: number;
}

export class AccountGroupCountDto extends AccountStatusCountDto {
  @ApiProperty({ nullable: true, type: String }) key!: string | null;
  @ApiProperty() label!: string;
}

export class AccountOverviewDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: AccountStatusCountDto }) byStatus!: AccountStatusCountDto;
  @ApiProperty({ type: AccountGroupCountDto, isArray: true }) bySeller!: AccountGroupCountDto[];
  @ApiProperty({ type: AccountGroupCountDto, isArray: true }) byPlatform!: AccountGroupCountDto[];
}
