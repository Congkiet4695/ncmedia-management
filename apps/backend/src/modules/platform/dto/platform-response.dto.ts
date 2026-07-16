import { ApiProperty } from '@nestjs/swagger';

/** Platform (Global — ADR-011). Dùng cho selector khi tạo/sửa Account. */
export class PlatformResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TIKTOK_SHOP' }) code!: string;
  @ApiProperty({ example: 'TikTok Shop' }) name!: string;
}
