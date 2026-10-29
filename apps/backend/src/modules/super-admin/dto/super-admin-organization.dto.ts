import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OrganizationStatus } from '@prisma/client';
import {
  SUPER_ADMIN_ORG_SORT_FIELDS,
  type SuperAdminOrgSortField,
} from '../constants/super-admin.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Bộ lọc danh sách Organization (§6). */
export class SuperAdminOrganizationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: OrganizationStatus,
    description: 'Lọc theo trạng thái: PENDING / ACTIVE / REJECTED …',
  })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional({ description: 'Tìm theo tên Organization, tên Owner hoặc email Owner' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: SUPER_ADMIN_ORG_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(SUPER_ADMIN_ORG_SORT_FIELDS)
  sortBy?: SuperAdminOrgSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

/**
 * Từ chối một Organization (§9).
 *
 * 🔴 `reason` BẮT BUỘC và có độ dài tối thiểu: lý do từ chối được gửi thẳng vào email cho
 * người đăng ký, và một chữ "no" thì họ không có cách nào sửa để nộp lại.
 */
export class RejectOrganizationDto {
  @ApiProperty({
    example: 'Thông tin doanh nghiệp chưa xác minh được. Vui lòng bổ sung giấy phép kinh doanh.',
    minLength: 10,
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'reason phải có ít nhất 10 ký tự' })
  @MaxLength(1000)
  reason!: string;
}

/**
 * Xác nhận XOÁ CỨNG Organization.
 *
 * 🔴 Server tự kiểm `confirmSlug` khớp slug của Organization — nút bấm ở giao diện không phải lớp bảo
 * vệ duy nhất: một request gửi nhầm id (hoặc gửi lại từ lịch sử) sẽ không xoá được tổ chức khác.
 */
export class DeleteOrganizationDto {
  @ApiProperty({ example: 'acme-co', description: 'Slug của Organization cần xoá — phải khớp chính xác' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  confirmSlug!: string;
}

export class OrganizationDeletionTableDto {
  @ApiProperty({ example: 'pod_orders' }) table!: string;
  @ApiProperty({ description: 'Số dòng đã xoá trực tiếp ở bảng này' }) deleted!: number;
}

export class OrganizationDeletionResultDto {
  @ApiProperty() organizationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ description: 'Tổng số dòng đã xoá trực tiếp (chưa gồm bảng con xoá theo CASCADE)' })
  deletedRows!: number;
  @ApiProperty({ type: [OrganizationDeletionTableDto], description: 'Chỉ liệt kê bảng có dữ liệu bị xoá' })
  tables!: OrganizationDeletionTableDto[];
  @ApiProperty({
    description:
      'Số bản ghi file (storage_files) đã xoá. File vật lý trên kho lưu trữ KHÔNG bị xoá — dọn theo quy trình riêng.',
  })
  storageFilesDeleted!: number;
  @ApiProperty() durationMs!: number;
}
