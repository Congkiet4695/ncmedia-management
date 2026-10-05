import { Controller, Get, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { xlsxFile } from '../../common/excel/excel.http';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user.interface';
import {
  EmployeeWorkFilterOptionsDto,
  EmployeeWorkPageDto,
  EmployeeWorkQueryDto,
} from './dto/pod-employee-work.dto';
import { PodEmployeeWorkService } from './services/pod-employee-work.service';

/**
 * Thống kê công việc nhân viên (Admin): listing · shop · đơn · lợi nhuận theo người, theo ngày.
 *
 * 🔴 Quyền: `report.read` VÀ `pod.shop.all` — số liệu cấp TỔ CHỨC, mọi shop. Mặc định chỉ role Admin có cả hai;
 * Seller (EMPLOYEE) không có `report.read` / `pod.shop.all` ⇒ 403. Không có `PodScopeGuard`: người có
 * `pod.shop.all` vốn thấy toàn tổ chức. Tổ chức luôn lấy từ JWT — Admin không xem được tổ chức khác.
 */
@ApiTags('POD Employee Work Statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.read', 'pod.shop.all')
@Controller('pod/employee-work-statistics')
export class PodEmployeeWorkController {
  constructor(private readonly service: PodEmployeeWorkService) {}

  @Get('filters')
  @ApiOperation({ summary: 'Lựa chọn cho bộ lọc: đơn vị tiền · người (nhân viên + người đã listing) · shop' })
  @ApiOkResponse({ type: EmployeeWorkFilterOptionsDto })
  filters(@CurrentUser() user: AuthenticatedUser): Promise<EmployeeWorkFilterOptionsDto> {
    return this.service.filterOptions(user.organizationId);
  }

  @Get()
  @ApiOperation({
    summary: 'Thống kê theo người: số shop · listing · đơn · lợi nhuận (+ chi tiết theo shop)',
    description:
      'Listing = sản phẩm ĐƯA LÊN SÀN thành công (Publish / Clone / Publish Live) do chính người đó chạy, mỗi ' +
      '(shop, sản phẩm TikTok) chỉ tính ở lần thành công đầu tiên. Shop của một người = shop họ listing trong ' +
      'khoảng ∪ shop của TikTok Account được gán cho họ. Đơn / lợi nhuận là của SHOP trong khoảng (ordered_at, ' +
      'giờ vận hành, một đơn vị tiền); lợi nhuận cùng công thức màn Order (đơn thiếu dữ kiện không tính, không coi là 0).',
  })
  @ApiOkResponse({ type: EmployeeWorkPageDto })
  @ApiBadRequestResponse({ description: 'EMPLOYEE_WORK_RANGE_INVALID / lỗi validate' })
  page(@CurrentUser() user: AuthenticatedUser, @Query() query: EmployeeWorkQueryDto): Promise<EmployeeWorkPageDto> {
    return this.service.page(user.organizationId, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Xuất Excel (theo nhân viên + chi tiết shop) — cùng bộ lọc, không phân trang' })
  @ApiOkResponse({ description: 'File .xlsx' })
  async export(@CurrentUser() user: AuthenticatedUser, @Query() query: EmployeeWorkQueryDto): Promise<StreamableFile> {
    const { buffer, filename } = await this.service.export(user.organizationId, query);
    return xlsxFile(buffer, filename);
  }
}
