import { ApiProperty } from '@nestjs/swagger';
import { ImportResultDto, ImportRowErrorDto } from '../../../common/excel/import-result.dto';

/**
 * Kết quả import Employee — mở rộng ImportResultDto chuẩn với:
 * - `durationMs`: thời gian xử lý (yêu cầu mục VI).
 * - `errorFile`: file Excel lỗi (base64) gồm cột gốc + cột `Error`, chỉ có khi import thất bại.
 *
 * Trả kèm trong cùng response để FE tải file lỗi ngay, không phải upload lại.
 */
export class EmployeeImportResultDto extends ImportResultDto {
  @ApiProperty({ description: 'Thời gian xử lý (ms)' })
  durationMs!: number;

  @ApiProperty({
    description: 'File Excel lỗi (base64, .xlsx) — null khi không có lỗi',
    nullable: true,
    type: String,
  })
  errorFile!: string | null;

  @ApiProperty({
    description: 'Tên file lỗi gợi ý — null khi không có lỗi',
    nullable: true,
    type: String,
  })
  errorFileName!: string | null;

  @ApiProperty({ type: ImportRowErrorDto, isArray: true })
  declare errors: ImportRowErrorDto[];
}
