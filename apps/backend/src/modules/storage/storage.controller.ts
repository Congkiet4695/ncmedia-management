import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  PaginatedStorageFileDto,
  StorageFileDto,
  StorageQueryDto,
  StorageReferenceQueryDto,
  UploadFileDto,
  UploadResultDto,
} from './dto/storage.dto';
import {
  STORAGE_ALLOWED_EXTENSIONS,
  STORAGE_MAX_FILES_PER_REQUEST,
  storageUploadOptions,
} from './storage.constants';
import { StorageMapper } from './storage.mapper';
import { StorageService } from './storage.service';

/**
 * StorageController — API dùng chung cho việc lưu trữ file toàn hệ thống.
 *
 * Tenant-scoped: `organizationId` lấy từ JWT (ADR-004), client KHÔNG được truyền vào.
 * RBAC: `storage.upload` / `storage.read` / `storage.delete`.
 *
 * Controller chỉ điều phối — mọi kiểm tra và nghiệp vụ nằm ở `StorageService`.
 * Không endpoint nào lộ `objectKey` / `bucket` (chi tiết hạ tầng).
 */
@ApiTags('Storage')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Thiếu permission (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('storage')
export class StorageController {
  constructor(
    private readonly service: StorageService,
    private readonly mapper: StorageMapper,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('storage.upload')
  @UseInterceptors(FilesInterceptor('files', STORAGE_MAX_FILES_PER_REQUEST, storageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tải file lên kho lưu trữ',
    description:
      `Gửi 1 hoặc nhiều file ở field \`files\` (tối đa ${STORAGE_MAX_FILES_PER_REQUEST}). ` +
      `Định dạng cho phép: ${STORAGE_ALLOWED_EXTENSIONS.join(', ')}. ` +
      'Tên file trên kho lưu trữ được sinh bằng UUID — KHÔNG dùng tên người dùng đặt. ' +
      'Nếu một file lỗi thì toàn bộ lần gọi bị huỷ và các file đã lên được gỡ bỏ.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files', 'module', 'referenceType'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        module: { type: 'string' },
        referenceType: { type: 'string' },
        referenceId: { type: 'string', format: 'uuid' },
        folder: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: UploadResultDto })
  @ApiBadRequestResponse({ description: 'Thiếu file / file rỗng / tham số không hợp lệ' })
  @ApiUnprocessableEntityResponse({ description: 'Định dạng không được hỗ trợ hoặc bị cấm' })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadFileDto,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<UploadResultDto> {
    const stored = await this.service.uploadMany(files, {
      organizationId: user.organizationId,
      actorUserId: user.userId,
      module: dto.module,
      referenceType: dto.referenceType,
      referenceId: dto.referenceId ?? null,
      folderSegments: this.service.defaultFolderSegments(
        user.organizationId,
        dto.module,
        dto.referenceType,
        dto.referenceId,
        dto.folder,
      ),
    });

    return { files: this.mapper.toDtoList(stored), count: stored.length };
  }

  @Get()
  @RequirePermissions('storage.read')
  @ApiOperation({ summary: 'Danh sách file của tổ chức (lọc theo module / tham chiếu)' })
  @ApiOkResponse({ type: PaginatedStorageFileDto })
  async findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StorageQueryDto,
  ): Promise<PaginatedStorageFileDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.service.findMany(user.organizationId, {
      page,
      limit,
      module: query.module,
      referenceType: query.referenceType,
      referenceId: query.referenceId,
    });

    return {
      items: this.mapper.toDtoList(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Đặt TRƯỚC `:id` — nếu không, Nest khớp "reference" vào route `:id` và
   * ParseUUIDPipe sẽ báo lỗi định dạng.
   */
  @Get('reference')
  @RequirePermissions('storage.read')
  @ApiOperation({ summary: 'Lấy toàn bộ file gắn với một thực thể nghiệp vụ' })
  @ApiOkResponse({ type: StorageFileDto, isArray: true })
  async findByReference(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StorageReferenceQueryDto,
  ): Promise<StorageFileDto[]> {
    const files = await this.service.findByReference(
      user.organizationId,
      query.referenceType,
      query.referenceId,
    );
    return this.mapper.toDtoList(files);
  }

  @Get(':id')
  @RequirePermissions('storage.read')
  @ApiOperation({ summary: 'Lấy metadata một file' })
  @ApiOkResponse({ type: StorageFileDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy file (STORAGE_FILE_NOT_FOUND)' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StorageFileDto> {
    return this.mapper.toDto(await this.service.findById(user.organizationId, id));
  }

  /**
   * Tải nội dung file qua API.
   *
   * Bắt buộc phải có: bucket R2 nên để private (không đọc công khai) — khi đó
   * `publicUrl` là null và đây là đường duy nhất lấy được file, đồng thời quyền
   * truy cập được kiểm tra theo tenant thay vì ai có link cũng xem được.
   */
  @Get(':id/download')
  @RequirePermissions('storage.read')
  @ApiOperation({ summary: 'Tải nội dung file (có kiểm tra quyền + tenant)' })
  @ApiOkResponse({ description: 'Nội dung nhị phân của file' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy file hoặc object đã mất trên kho lưu trữ' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { file, body } = await this.service.download(user.organizationId, id);
    return new StreamableFile(body, {
      type: file.mimeType,
      // Loại CR/LF/dấu nháy khỏi tên file để không thể chèn header (response splitting).
      disposition: `inline; filename="${file.originalName.replace(/[\r\n"]/g, '')}"`,
      length: file.fileSize,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('storage.delete')
  @ApiOperation({
    summary: 'Xoá file khỏi kho lưu trữ',
    description:
      'Từ chối nếu file đang được một bản ghi nghiệp vụ tham chiếu — phải xoá ở màn hình ' +
      'nghiệp vụ tương ứng để dữ liệu không bị đứt liên kết.',
  })
  @ApiOkResponse({ description: 'Đã xoá; data = null' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy file (STORAGE_FILE_NOT_FOUND)' })
  @ApiConflictResponse({ description: 'File đang được sử dụng (STORAGE_FILE_IN_USE)' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(user.organizationId, user.userId, id);
  }
}
