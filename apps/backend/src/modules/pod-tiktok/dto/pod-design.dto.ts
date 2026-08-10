import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PodDesignPlacement } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** Vị trí in được BẬT ở giai đoạn hiện tại (UI chỉ hiển thị các vị trí này). */
export const POD_ACTIVE_PLACEMENTS: PodDesignPlacement[] = [
  PodDesignPlacement.FRONT,
  PodDesignPlacement.BACK,
];

/** Một file design của sản phẩm. */
export class PodDesignDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PodDesignPlacement, example: 'FRONT' }) placement!: PodDesignPlacement;
  @ApiProperty({ description: 'URL công khai để preview/tải về' }) fileUrl!: string;
  @ApiProperty({ description: 'Tên file gốc người dùng đã chọn' }) fileName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ description: 'Kích thước (byte)' }) fileSize!: number;
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

/** Toàn bộ design của một sản phẩm. */
export class PodItemDesignsDto {
  @ApiProperty() orderItemId!: string;
  @ApiProperty({ type: PodDesignDto, isArray: true }) designs!: PodDesignDto[];
}
