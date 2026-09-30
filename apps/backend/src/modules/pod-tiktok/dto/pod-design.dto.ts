import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PodDesignPlacement } from '@prisma/client';
import { IsEnum, IsOptional, IsUrl, MaxLength } from 'class-validator';

/** Vị trí in được BẬT ở giai đoạn hiện tại (UI chỉ hiển thị các vị trí này). */
export const POD_ACTIVE_PLACEMENTS: PodDesignPlacement[] = [
  PodDesignPlacement.FRONT,
  PodDesignPlacement.BACK,
];

/** Một file design của sản phẩm. */
export class PodDesignDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PodDesignPlacement, example: 'FRONT' }) placement!: PodDesignPlacement;
  @ApiProperty({
    enum: ['UPLOAD', 'URL'],
    description: 'UPLOAD: file upload lên kho lưu trữ · URL: URL công khai nhập trực tiếp',
  })
  source!: 'UPLOAD' | 'URL';
  @ApiProperty({ description: 'URL công khai để preview/tải về' }) fileUrl!: string;
  @ApiProperty({ description: 'Tên file gốc (UPLOAD) hoặc đoạn cuối của URL (URL)' })
  fileName!: string;
  @ApiProperty({ nullable: true, type: String, description: 'NULL với nguồn URL (không tải file về)' })
  mimeType!: string | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Kích thước (byte); NULL với nguồn URL' })
  fileSize!: number | null;
  @ApiProperty({ description: 'Số lần thay design ở vị trí này (1 = upload lần đầu)' })
  version!: number;
  @ApiProperty({ description: 'Thời điểm upload gần nhất' }) uploadedAt!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Người upload' })
  uploadedByName!: string | null;
}

/** Tham số đường dẫn khi thao tác design. */
export class PodDesignPlacementParamDto {
  @ApiProperty({ enum: PodDesignPlacement })
  @IsEnum(PodDesignPlacement, { message: 'Vị trí in không hợp lệ' })
  placement!: PodDesignPlacement;
}

/** Body upload (multipart) — file đi kèm ở field `file`. */
export class UploadDesignDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Ảnh design (PNG/JPEG/WEBP). Bắt buộc.',
  })
  @IsOptional()
  file?: unknown;
}

/**
 * Đặt design bằng URL CÔNG KHAI (không upload lại file).
 *
 * 🔴 Chỉ HTTPS: nhà cung cấp tải file thẳng từ URL này. Kiểm tra địa chỉ nội bộ / công khai nằm
 * ở `ProductDesignService` (validator không biết host nào là nội bộ).
 */
export class SetDesignUrlDto {
  @ApiProperty({ example: 'https://cdn.example.com/designs/front.png' })
  @IsUrl(
    { protocols: ['https'], require_protocol: true, require_tld: true },
    { message: 'URL design phải là địa chỉ HTTPS công khai hợp lệ' },
  )
  @MaxLength(2048)
  url!: string;
}

/** Toàn bộ design của một sản phẩm. */
export class PodItemDesignsDto {
  @ApiProperty() orderItemId!: string;
  @ApiProperty({ type: PodDesignDto, isArray: true }) designs!: PodDesignDto[];
}
