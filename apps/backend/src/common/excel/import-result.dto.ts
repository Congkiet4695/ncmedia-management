import { ApiProperty } from '@nestjs/swagger';

/** Một lỗi ở một dòng khi import. */
export class ImportRowErrorDto {
  @ApiProperty({ description: 'Tên sheet (nếu nhiều sheet)', nullable: true, type: String })
  sheet!: string | null;

  @ApiProperty({ description: 'Số dòng Excel (1-based, header = 1)' })
  row!: number;

  @ApiProperty({ nullable: true, type: String, description: 'Cột/field liên quan' })
  field!: string | null;

  @ApiProperty({ description: 'Mô tả lỗi' })
  message!: string;
}

/** Kết quả import chuẩn cho Account/Order. */
export class ImportResultDto {
  @ApiProperty({ description: 'Tổng số dòng dữ liệu đọc được' })
  total!: number;

  @ApiProperty({ description: 'Số dòng tạo mới' })
  created!: number;

  @ApiProperty({ description: 'Số dòng cập nhật (import-update)' })
  updated!: number;

  @ApiProperty({ description: 'Số dòng bỏ qua (đã tồn tại)' })
  skipped!: number;

  @ApiProperty({ description: 'Số dòng lỗi' })
  failed!: number;

  @ApiProperty({ type: ImportRowErrorDto, isArray: true })
  errors!: ImportRowErrorDto[];
}
