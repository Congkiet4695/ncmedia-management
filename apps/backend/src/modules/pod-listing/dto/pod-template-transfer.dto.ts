import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
} from 'class-validator';
import {
  POD_TEMPLATE_KINDS,
  POD_TEMPLATE_BUNDLE_VERSION,
  type PodTemplateKind,
} from '../constants/pod-listing.constants';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

/** Số template tối đa trong một gói Import — chặn file khổng lồ khoá transaction. */
export const POD_TEMPLATE_BUNDLE_MAX_ITEMS = 200;

/**
 * Gói Import/Export template.
 *
 * Cố ý dùng **JSON chứ không phải Excel** cho phần định nghĩa template: một Category
 * Template mang cây thuộc tính nhiều giá trị, một SKU Template mang nhiều trục — ép xuống
 * lưới hai chiều là mất cấu trúc. Riêng BẢNG SKU (giá / tồn / barcode từng dòng) đúng là
 * dữ liệu dạng lưới nên vẫn có Import/Export Excel riêng.
 *
 * Gói KHÔNG chứa `id`, `organizationId` hay dấu vết audit: import là **tạo mới trong tổ
 * chức đang đăng nhập**, không bao giờ ghi đè bản ghi của tổ chức khác.
 */
export class ImportTemplateBundleDto {
  @ApiPropertyOptional({ default: POD_TEMPLATE_BUNDLE_VERSION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  version?: number;

  @ApiPropertyOptional({ enum: POD_TEMPLATE_KINDS })
  @IsOptional()
  @IsIn(POD_TEMPLATE_KINDS)
  kind?: PodTemplateKind;

  @ApiProperty({
    description: 'Danh sách template trong gói — đúng cấu trúc mà Export sinh ra.',
    type: 'array',
    items: { type: 'object' },
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(POD_TEMPLATE_BUNDLE_MAX_ITEMS)
  @IsObject({ each: true })
  items!: Array<Record<string, unknown>>;

  @ApiPropertyOptional({
    default: true,
    description: 'Trùng tên thì tự thêm hậu tố thay vì báo lỗi.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  renameOnConflict?: boolean;
}

/** Lỗi của MỘT phần tử trong gói Import. */
export interface ImportTemplateItemError {
  /** Vị trí trong mảng `items` (0-based) — khớp đúng file người dùng gửi lên. */
  index: number;
  name: string | null;
  message: string;
}

/** Kết quả một lần Import. */
export interface ImportTemplateResult {
  total: number;
  created: number;
  failed: number;
  errors: ImportTemplateItemError[];
}

/** Gói Export trả về cho client. */
export interface ExportTemplateBundle<T = Record<string, unknown>> {
  version: number;
  kind: PodTemplateKind;
  exportedAt: string;
  count: number;
  items: T[];
}
