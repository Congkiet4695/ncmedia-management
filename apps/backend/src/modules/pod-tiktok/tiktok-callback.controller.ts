import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

/** Tham số KHÔNG được ghi log dưới bất kỳ hình thức nào (đổi được lấy access token). */
const SENSITIVE_QUERY_KEYS = new Set(['auth_code', 'code', 'access_token', 'refresh_token']);

/** Trang công khai hiển thị Authorization Code cho Seller. */
const LINK_SUCCESS_PATH = '/tiktok/link-success';

/**
 * TiktokCallbackController — điểm TikTok redirect về sau khi Seller bấm Approve.
 *
 * ⚠️ **Công khai có chủ ý**: không `@UseGuards` — TikTok redirect trình duyệt của Seller tới
 * đây khi họ CHƯA đăng nhập hệ thống. Đặt guard vào là Seller lạc sang màn hình login và mất
 * luôn `auth_code` trên URL. Endpoint này KHÔNG đọc và KHÔNG ghi dữ liệu: nó chỉ chuyển hướng.
 *
 * Việc đổi `auth_code` lấy token vẫn nằm nguyên ở `POST /pod/tiktok/accounts/link` — có xác
 * thực và có kiểm quyền. Ở đây cố tình KHÔNG tự động đổi token, vì request này không mang danh
 * tính người dùng nên không thể biết mã thuộc về tổ chức nào.
 */
@ApiTags('POD — TikTok Callback')
@Controller('tiktok')
export class TiktokCallbackController {
  private readonly logger = new Logger(TiktokCallbackController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('callback')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Redirect URL đăng ký với TikTok',
    description:
      'TikTok chuyển hướng trình duyệt Seller về đây kèm `auth_code`. Endpoint chuyển tiếp ' +
      'NGUYÊN VĂN toàn bộ query string sang trang công khai hiển thị mã.',
  })
  callback(@Req() req: Request, @Res() res: Response): void {
    // Lấy NGUYÊN chuỗi query gốc thay vì dựng lại từ `req.query`: tham số TikTok bổ sung
    // sau này tự động đi theo, và không có nguy cơ sai mã hoá khi tuần tự hoá lại.
    const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';

    // 🔴 Chỉ ghi TÊN tham số, không bao giờ ghi giá trị — `auth_code` đổi được lấy token.
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'oauth.callback',
      receivedParams: Object.keys(req.query).map((key) =>
        SENSITIVE_QUERY_KEYS.has(key) ? `${key}=<redacted>` : key,
      ),
      msg: 'Nhận redirect uỷ quyền từ TikTok',
    });

    const base = (this.config.get<string>('tiktok.callbackRedirectBase') ?? '').replace(/\/+$/, '');
    const target = `${base}${LINK_SUCCESS_PATH}${queryString ? `?${queryString}` : ''}`;

    // 302: trình duyệt đi tiếp sang trang hiển thị mã. Không đặt cookie, không lưu gì.
    res.redirect(target);
  }
}
