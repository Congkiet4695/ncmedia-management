import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  CatalogSyncResultDto,
  FulfillmentAccountDto,
  PlatformProviderDto,
  SetGlobalProviderDto,
} from '../dto/fulfillment.dto';
import { PlatformFulfillmentService } from '../services/platform-fulfillment.service';

/**
 * **Nhà cung cấp fulfillment dùng chung** — khu vực quản trị NỀN TẢNG.
 *
 * ```
 *   Super Admin
 *      └─ bật cờ "dùng chung" cho một tài khoản nhà cung cấp
 *      └─ bấm Đồng bộ danh mục   →  MangoTeePrints API  →  MỘT bản danh mục trong database
 *                                                             ↑
 *              Organization A · B · C … đều đọc từ đúng bản này
 * ```
 *
 * 🔴 Vì sao đặt ở đây chứ không để mỗi tổ chức tự đồng bộ: danh mục sản phẩm là dữ liệu của
 * NHÀ CUNG CẤP, giống hệt TikTok Master Data (danh mục/thương hiệu) — xem
 * `PodMasterDataController`. Mỗi tổ chức tự kéo về một bản là vừa nhân bản 284 sản phẩm ×
 * 12.894 biến thể cho từng tổ chức, vừa khiến dữ liệu giữa các tổ chức lệch nhau tuỳ ai bấm
 * Sync lúc nào.
 *
 * Hai lớp guard đúng khuôn của `PodMasterDataController`: `SuperAdminGuard` chốt "đúng người"
 * (role SUPER_ADMIN **và** Organization `is_platform`), `@RequirePermissions('platform.*')`
 * chốt "đúng việc". Quyền `platform.*` bị loại khỏi catalog cấp cho org admin.
 */
@ApiTags('Platform — Fulfillment Providers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Access token không hợp lệ (AUTH_TOKEN_INVALID)' })
@ApiForbiddenResponse({ description: 'Không phải Super Admin nền tảng (AUTH_FORBIDDEN)' })
@UseGuards(JwtAuthGuard, SuperAdminGuard, PermissionsGuard)
@Controller('platform/fulfillment/providers')
export class PlatformFulfillmentController {
  constructor(private readonly service: PlatformFulfillmentService) {}

  @Get()
  @RequirePermissions('platform.fulfillment.read')
  @ApiOperation({
    summary: 'Danh sách nhà cung cấp fulfillment của toàn nền tảng',
    description:
      'Mỗi dòng kèm số sản phẩm/biến thể ĐANG CÓ trong database (đếm thật, không phải con số ' +
      'nhà cung cấp báo), lần đồng bộ gần nhất và kết quả của lượt đó. Cờ `isGlobal` cho biết ' +
      'tài khoản đã được chia sẻ cho mọi tổ chức hay chưa.',
  })
  @ApiOkResponse({ type: PlatformProviderDto, isArray: true })
  list(): Promise<PlatformProviderDto[]> {
    return this.service.list();
  }

  @Patch(':id/global')
  @RequirePermissions('platform.fulfillment.manage')
  @ApiOperation({
    summary: 'Bật/tắt chế độ DÙNG CHUNG cho một nhà cung cấp',
    description:
      'Bật ⇒ mọi Organization đọc được danh mục của tài khoản này và chọn được nó khi gửi đơn. ' +
      'Tắt ⇒ chỉ tổ chức sở hữu dùng được (hành vi cũ). Không đụng tới danh mục đã đồng bộ, ' +
      'không đụng tới ánh xạ sản phẩm hay đơn đã gửi.',
  })
  @ApiOkResponse({ type: FulfillmentAccountDto })
  setGlobal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetGlobalProviderDto,
  ): Promise<FulfillmentAccountDto> {
    return this.service.setGlobal(user.userId, id, dto.isGlobal);
  }

  @Post(':id/catalog/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.fulfillment.sync')
  @ApiOperation({
    summary: 'Đồng bộ danh mục nhà cung cấp (CHỈ Super Admin)',
    description:
      'Kéo Catalogue → Product → Variant từ nhà cung cấp và ghi vào MỘT bản danh mục dùng ' +
      'chung. Idempotent: khoá ghi là `(account_id, external_product_id)` / ' +
      '`(account_id, external_variant_id)` — chạy lại chỉ UPDATE, không bao giờ sinh bản ghi ' +
      'trùng.\\n\\n' +
      '⚠️ Danh mục lớn là tác vụ DÀI (hàng nghìn lời gọi, tự giới hạn 10 request/giây theo ' +
      'quy định của nhà cung cấp). `complete = false` ⇒ có lượt đọc bị cụt và bước đánh dấu ' +
      'ngừng bán bị BỎ QUA để không xoá nhầm danh mục khỏi các ô chọn.',
  })
  @ApiOkResponse({ type: CatalogSyncResultDto })
  sync(@Param('id', ParseUUIDPipe) id: string): Promise<CatalogSyncResultDto> {
    return this.service.syncCatalog(id);
  }
}
