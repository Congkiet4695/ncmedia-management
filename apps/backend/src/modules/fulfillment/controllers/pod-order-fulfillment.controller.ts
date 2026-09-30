import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { FulfillmentTrigger } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PodScope } from '../../pod-tiktok/decorators/pod-scope.decorator';
import { PodScopeGuard } from '../../pod-tiktok/guards/pod-scope.guard';
import type { PodAccessScope } from '../../pod-tiktok/services/pod-access-scope.service';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  FulfillPodOrderDto,
  FulfillmentOrderDto,
  FetchTiktokLabelDto,
  SaveShippingLabelDto,
  ShippingLabelDto,
  UpdateFulfillmentOrderDto,
} from '../dto/fulfillment.dto';
import { FulfillmentProviderGateway } from '../services/fulfillment-provider.gateway';
import { FulfillmentShippingLabelService } from '../services/fulfillment-shipping-label.service';
import { FulfillmentService } from '../services/fulfillment.service';

/**
 * Cùng một hành động "gửi đơn POD đi sản xuất", đặt dưới đường dẫn theo góc nhìn ĐƠN HÀNG.
 *
 * `/fulfillment/orders/:podOrderId/fulfill` nhìn từ phía module fulfillment (kèm cấu hình,
 * ánh xạ sản phẩm, lịch sử, webhook). `/pod/orders/:id/fulfill` nhìn từ phía đơn POD — đây là
 * đường dẫn tự nhiên cho ai đang thao tác trên một đơn cụ thể.
 *
 * Cả hai gọi ĐÚNG một service, cùng permission, cùng validate, cùng chống gửi trùng — không có
 * nhánh xử lý thứ hai nào được tạo ra.
 */
@ApiTags('POD Orders — Fulfillment')
@ApiBearerAuth()
// 🔴 Controller này từng KHÔNG có guard nào: `@RequirePermissions` chỉ là metadata, không có
// `PermissionsGuard` thì không ai đọc nó; không có `JwtAuthGuard` thì `request.user` là undefined
// ⇒ `user.organizationId` ném TypeError ⇒ 500 "Internal server error" (chính là lỗi "Get label
// from TikTok"). Cả ba guard giống hệt `FulfillmentController`.
@UseGuards(JwtAuthGuard, PermissionsGuard, PodScopeGuard)
@Controller('pod/orders')
export class PodOrderFulfillmentController {
  constructor(
    private readonly service: FulfillmentService,
    private readonly gateway: FulfillmentProviderGateway,
    private readonly labelService: FulfillmentShippingLabelService,
  ) {}

  @Post(':id/fulfill')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Gửi đơn POD sang xưởng in',
    description:
      'Bí danh của `POST /fulfillment/orders/{podOrderId}/fulfill`. ' +
      'Validate đơn/tài khoản/địa chỉ/design/ánh xạ biến thể → gọi API nhà cung cấp → lưu ' +
      'request, response, trạng thái và thời điểm gửi. Đơn đã gửi thành công KHÔNG gửi lại được.',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  @ApiUnprocessableEntityResponse({
    description: 'FULFILLMENT_NOT_READY (kèm danh sách lý do) · FULFILLMENT_CONFIG_MISSING',
  })
  @ApiConflictResponse({ description: 'FULFILLMENT_ALREADY_SUBMITTED' })
  @ApiBadRequestResponse({ description: 'FULFILLMENT_PROVIDER_VALIDATION' })
  async fulfill(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: FulfillPodOrderDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.gateway.fulfill(
      user.organizationId,
      user.userId,
      podOrderId,
      FulfillmentTrigger.MANUAL,
      dto ?? {},
      scope,
    );
    return this.service.toOrderDto(record);
  }

  @Post(':id/fulfillment/tiktok-label')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Lấy nhãn vận chuyển của đơn từ TikTok',
    description:
      'Dùng khi giao bằng nhãn TikTok ("By TikTok") hoặc khi TikTok che địa chỉ người nhận: xưởng ' +
      'in chỉ cần nhãn, địa chỉ thật nằm trên nhãn.\n\n' +
      '**Không bao giờ tạo gói thứ hai.** Đơn đã có `package` (database, hoặc TikTok qua Get Order ' +
      'Detail) ⇒ chỉ gọi Get Package Shipping Document cho đúng gói đó. Chưa có gói ⇒ Get Eligible ' +
      'Shipping Service → chọn dịch vụ (duy nhất / mặc định của TikTok / `shippingServiceId` người ' +
      'dùng chọn) → Create Packages (không retry; timeout ⇒ đối soát bằng Get Order Detail) → Get ' +
      'Package Shipping Document. ' +
      'Có khoá phân tán theo đơn nên bấm liên tiếp/hai người cùng bấm đều an toàn.\n\n' +
      'Kết quả được LƯU vào database (nhãn · package id · tracking) rồi mới trả về.',
  })
  @ApiOkResponse({ type: ShippingLabelDto })
  @ApiConflictResponse({ description: 'SHIPPING_LABEL_BUSY — đang có lượt lấy nhãn khác chạy.' })
  @ApiUnprocessableEntityResponse({
    description:
      'TIKTOK_SCOPE_MISSING · TIKTOK_SHOP_CONTEXT_UNAVAILABLE · TIKTOK_ORDER_NOT_FOUND · ' +
      'TIKTOK_ORDER_NOT_PACKABLE · TIKTOK_LABEL_NOT_TIKTOK_SHIPPING · ' +
      'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE · TIKTOK_SHIPPING_SERVICE_SELECTION_REQUIRED · ' +
      'TIKTOK_SHIPPING_SERVICE_INVALID · TIKTOK_PACKAGE_CREATE_FAILED · ' +
      'TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE · TIKTOK_RATE_LIMITED · TIKTOK_UNREACHABLE · ' +
      'TIKTOK_SHIPPING_LABEL_UNAVAILABLE · SHIPPING_LABEL_INTERNAL_ERROR (kèm `details` an toàn)',
  })
  getTiktokLabel(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: FetchTiktokLabelDto,
  ): Promise<ShippingLabelDto> {
    return this.labelService.fetchFromTiktok(
      user.organizationId,
      user.userId,
      podOrderId,
      { shippingServiceId: dto?.shippingServiceId },
      scope,
    );
  }

  @Put(':id/fulfillment/label')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Lưu nhãn vận chuyển do người vận hành tự dán',
    description:
      'Ghi URL nhãn xuống DATABASE. Đây là điều kiện để gửi sản xuất một đơn mà TikTok đã che ' +
      'địa chỉ — backend đọc nhãn từ database chứ không từ form, nên mở lại màn hình hay gửi ' +
      'từ máy khác đều thấy đúng nhãn này.',
  })
  @ApiOkResponse({ type: ShippingLabelDto })
  saveLabel(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: SaveShippingLabelDto,
  ): Promise<ShippingLabelDto> {
    return this.labelService.saveManualLabel(
      user.organizationId,
      user.userId,
      podOrderId,
      dto.labelUrl,
      scope,
    );
  }

  @Delete(':id/fulfillment/label')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Gỡ nhãn vận chuyển khỏi đơn',
    description: 'Dùng khi dán nhầm URL. Không đụng tới gói hàng đã tạo phía TikTok.',
  })
  clearLabel(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) podOrderId: string,
  ): Promise<void> {
    return this.labelService.clearLabel(user.organizationId, podOrderId, scope);
  }

  @Patch(':id/fulfillment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Sửa đơn đã gửi (nhãn · ghi chú · phương thức vận chuyển)',
    description:
      'Gọi Update Order của nhà cung cấp. Chỉ dùng được khi đơn CHƯA vào sản xuất. Sửa nhãn ' +
      'hoặc phương thức vận chuyển khiến nhà cung cấp TÍNH LẠI chi phí — giá vốn mới được áp ' +
      'ngay vào đơn.',
  })
  @ApiOkResponse({ type: FulfillmentOrderDto })
  @ApiConflictResponse({ description: 'FULFILLMENT_CANNOT_UPDATE' })
  @ApiUnprocessableEntityResponse({
    description: 'FULFILLMENT_OPERATION_NOT_SUPPORTED — nhà cung cấp không có API sửa đơn (Sellerwix)',
  })
  async updateFulfillment(
    @CurrentUser() user: AuthenticatedUser,
    @PodScope() scope: PodAccessScope,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: UpdateFulfillmentOrderDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.gateway.updateAtProvider(
      user.organizationId,
      user.userId,
      podOrderId,
      {
        labelUrl: dto.labelUrl,
        note: dto.note,
        shippingMethod: dto.shippingMethod,
      },
      scope,
    );
    return this.service.toOrderDto(record);
  }
}
