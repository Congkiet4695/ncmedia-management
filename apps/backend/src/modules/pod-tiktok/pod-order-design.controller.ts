import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PodDesignPlacement } from '@prisma/client';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import { PodDesignDto } from './dto/pod-design.dto';
import { PodOrderDesignService } from './services/pod-order-design.service';
import { designUploadOptions } from './constants/pod-design.constants';

/**
 * PodOrderDesignController — quản lý file design in cho TỪNG sản phẩm của đơn POD.
 *
 * RESTful theo tài nguyên lồng nhau:
 *   /pod/tiktok/order-items/{orderItemId}/designs[/{placement}]
 *
 * Tenant-scoped (organizationId từ JWT — ADR-004) + RBAC `pod.tiktok.design.*`.
 * Mỗi (sản phẩm × vị trí in) độc lập — thao tác một vị trí không ảnh hưởng vị trí/sản phẩm khác.
 */
@ApiTags('POD - Order Item Designs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pod/tiktok/order-items/:orderItemId/designs')
export class PodOrderDesignController {
  constructor(private readonly service: PodOrderDesignService) {}

  @Get()
  @RequirePermissions('pod.tiktok.order.read')
  @ApiOperation({ summary: 'Lấy toàn bộ design đã upload của một sản phẩm' })
  @ApiOkResponse({ type: PodDesignDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Không tìm thấy sản phẩm trong tổ chức' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderItemId', ParseUUIDPipe) orderItemId: string,
  ): Promise<PodDesignDto[]> {
    return this.service.findByItem(user.organizationId, orderItemId);
  }

  @Post(':placement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.design.upload')
  @UseInterceptors(FileInterceptor('file', designUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiParam({
    name: 'placement',
    enum: PodDesignPlacement,
    description: 'Vị trí in. Giai đoạn hiện tại dùng FRONT và BACK.',
  })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Upload / thay thế design tại một vị trí in',
    description:
      'Nếu vị trí đã có design thì file cũ bị thay thế (tăng version, xoá file cũ khỏi storage). ' +
      'Chấp nhận PNG/JPEG/WEBP, giới hạn dung lượng theo cấu hình UPLOAD_MAX_IMAGE_BYTES.',
  })
  @ApiOkResponse({ type: PodDesignDto })
  @ApiBadRequestResponse({ description: 'Thiếu file / sai định dạng / vượt dung lượng' })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderItemId', ParseUUIDPipe) orderItemId: string,
    @Param('placement', new ParseEnumPipe(PodDesignPlacement)) placement: PodDesignPlacement,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<PodDesignDto> {
    return this.service.upload(user.organizationId, user.userId, orderItemId, placement, file);
  }

  @Delete(':placement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('pod.tiktok.design.delete')
  @ApiParam({ name: 'placement', enum: PodDesignPlacement })
  @ApiOperation({ summary: 'Xoá design tại một vị trí in' })
  @ApiOkResponse({ description: 'Đã xoá; data = null' })
  @ApiNotFoundResponse({ description: 'Sản phẩm chưa có design tại vị trí này' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderItemId', ParseUUIDPipe) orderItemId: string,
    @Param('placement', new ParseEnumPipe(PodDesignPlacement)) placement: PodDesignPlacement,
  ): Promise<void> {
    return this.service.remove(user.organizationId, user.userId, orderItemId, placement);
  }
}
