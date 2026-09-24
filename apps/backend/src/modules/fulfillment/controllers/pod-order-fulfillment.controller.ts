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
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../../auth/types/authenticated-user.interface';
import {
  FulfillPodOrderDto,
  FulfillmentOrderDto,
  SaveShippingLabelDto,
  ShippingLabelDto,
  UpdateFulfillmentOrderDto,
} from '../dto/fulfillment.dto';
import { MangoFulfillmentService } from '../mango/services/mango-fulfillment.service';
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
@Controller('pod/orders')
export class PodOrderFulfillmentController {
  constructor(
    private readonly service: FulfillmentService,
    private readonly mangoService: MangoFulfillmentService,
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
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: FulfillPodOrderDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.fulfill(
      user.organizationId,
      user.userId,
      podOrderId,
      FulfillmentTrigger.MANUAL,
      dto ?? {},
    );
    return this.service.toOrderDto(record);
  }

  @Post(':id/fulfillment/tiktok-label')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fulfillment.create')
  @ApiOperation({
    summary: 'Lấy nhãn vận chuyển của đơn từ TikTok',
    description:
      'Dùng khi TikTok che địa chỉ người nhận (đơn 4PL / đơn quá hạn hiển thị): xưởng in chỉ ' +
      'cần nhãn, địa chỉ thật nằm trên nhãn.\n\n' +
      '**Không bao giờ tạo gói thứ hai.** Đơn đã có `package` (đồng bộ từ TikTok hoặc do lần ' +
      'bấm trước tạo ra) ⇒ chỉ gọi Get Package Shipping Document cho đúng gói đó. Chưa có gói ' +
      '⇒ Get Eligible Shipping Service → Create Packages → Get Package Shipping Document. ' +
      'Có khoá phân tán theo đơn nên bấm liên tiếp/hai người cùng bấm đều an toàn.\n\n' +
      'Kết quả được LƯU vào database (nhãn · package id · tracking) rồi mới trả về.',
  })
  @ApiOkResponse({ type: ShippingLabelDto })
  @ApiConflictResponse({ description: 'SHIPPING_LABEL_BUSY — đang có lượt lấy nhãn khác chạy.' })
  @ApiUnprocessableEntityResponse({
    description:
      'TIKTOK_NO_ELIGIBLE_SHIPPING_SERVICE · TIKTOK_SHIPPING_DOCUMENT_UNAVAILABLE · ' +
      'TIKTOK_SCOPE_MISSING · TIKTOK_RATE_LIMITED · TIKTOK_SHIPPING_LABEL_UNAVAILABLE',
  })
  getTiktokLabel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) podOrderId: string,
  ): Promise<ShippingLabelDto> {
    return this.labelService.fetchFromTiktok(user.organizationId, user.userId, podOrderId);
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
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: SaveShippingLabelDto,
  ): Promise<ShippingLabelDto> {
    return this.labelService.saveManualLabel(
      user.organizationId,
      user.userId,
      podOrderId,
      dto.labelUrl,
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
    @Param('id', ParseUUIDPipe) podOrderId: string,
  ): Promise<void> {
    return this.labelService.clearLabel(user.organizationId, podOrderId);
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
  async updateFulfillment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) podOrderId: string,
    @Body() dto: UpdateFulfillmentOrderDto,
  ): Promise<FulfillmentOrderDto> {
    const record = await this.mangoService.updateAtProvider(
      user.organizationId,
      user.userId,
      podOrderId,
      {
        labelUrl: dto.labelUrl,
        note: dto.note,
        shippingMethod: dto.shippingMethod,
      },
    );
    return this.service.toOrderDto(record);
  }
}
