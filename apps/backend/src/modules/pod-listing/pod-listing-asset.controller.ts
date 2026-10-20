import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { StorageFileDto } from '../storage/dto/storage.dto';
import { POD_LISTING_IMAGE_URL_MAX_LENGTH } from './constants/pod-listing.constants';
import { PodListingImageUrlService } from './services/pod-listing-image-url.service';

export class ImportListingImageUrlDto {
  @ApiProperty({ example: 'https://cdn.example.com/products/tee-front.jpg', maxLength: POD_LISTING_IMAGE_URL_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(POD_LISTING_IMAGE_URL_MAX_LENGTH)
  // Lớp hình thức; hàng rào thật (IP nội bộ, redirect, cổng) nằm ở `fetchRemoteFile`.
  @Matches(/^https?:\/\//i, { message: 'Chỉ nhận URL http/https' })
  url!: string;
}

@ApiTags('POD - Listing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/listing-assets')
export class PodListingAssetController {
  constructor(private readonly imageUrls: PodListingImageUrlService) {}

  @Post('from-url')
  @HttpCode(HttpStatus.CREATED)
  // Cùng quyền với tải ảnh từ máy (`POST /storage/upload`) — đây chỉ là nguồn khác của cùng một file.
  @RequirePermissions('storage.upload')
  @ApiOperation({
    summary: 'Thêm ảnh sản phẩm bằng URL (tải về server rồi lưu Storage)',
    description:
      'Server tải ảnh qua hàng rào SSRF (chỉ http/https cổng 80/443, chặn localhost / IP nội bộ / metadata, ' +
      'kiểm lại mỗi bước chuyển hướng, giới hạn thời gian & dung lượng), kiểm CHỮ KÝ file (JPEG/PNG/WEBP, ≤ 5 MB) ' +
      'rồi lưu như ảnh tải từ máy. Trả về file Storage — form dùng `id` làm `fileId` như ảnh upload.',
  })
  @ApiCreatedResponse({ type: StorageFileDto })
  @ApiBadRequestResponse({ description: 'POD_LISTING_IMAGE_URL_INVALID (URL sai dạng / trỏ vào địa chỉ nội bộ)' })
  @ApiUnprocessableEntityResponse({
    description: 'POD_LISTING_IMAGE_URL_FETCH_FAILED (HTTP lỗi, cần đăng nhập, không phải ảnh, quá lớn, quá lâu)',
  })
  importFromUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportListingImageUrlDto,
  ): Promise<StorageFileDto> {
    return this.imageUrls.importImage(user.organizationId, user.userId, dto.url);
  }
}
