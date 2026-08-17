import { Controller, Get, Headers, Ip, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  TIKTOK_CALLBACK_CODE_PARAMS,
  TIKTOK_CALLBACK_ERROR_PARAM,
  TIKTOK_AUTHORIZE_STATE_PARAM,
} from './constants/tiktok.constants';
import { TiktokLinkResultQueryDto } from './dto/tiktok-oauth.dto';
import { PodTiktokLinkResultDto } from './dto/pod-tiktok-response.dto';
import { PodTiktokOAuthService } from './services/pod-tiktok-oauth.service';

/** Trang kết quả (công khai) — Seller có thể chưa đăng nhập hệ thống khi tới đây. */
const LINK_SUCCESS_PATH = '/tiktok/link-success';
const LINK_FAILED_PATH = '/tiktok/link-failed';

/**
 * TiktokCallbackController — điểm TikTok redirect về sau khi Seller bấm Approve.
 *
 * ⚠️ **Công khai có chủ ý**: không `@UseGuards` — TikTok redirect trình duyệt của Seller tới
 * đây khi họ CHƯA đăng nhập hệ thống. Đặt guard vào là Seller lạc sang màn hình login và
 * phiên uỷ quyền hỏng.
 *
 * 🔴 Danh tính KHÔNG lấy từ request (không cookie, không JWT) mà từ bản ghi `state` đã được
 * xác thực — đó là lý do `state` bắt buộc phải có, phải ngẫu nhiên và chỉ dùng một lần.
 *
 * Toàn bộ phần còn lại chạy TỰ ĐỘNG ngay tại đây: đổi `auth_code` lấy token → Get Authorized
 * Shops → lưu kết nối → chuyển hướng sang trang kết quả. Người dùng KHÔNG copy/dán gì cả
 * (yêu cầu App Review của TikTok).
 */
@ApiTags('POD — TikTok Callback')
@Controller('tiktok')
export class TiktokCallbackController {
  private readonly logger = new Logger(TiktokCallbackController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly oauthService: PodTiktokOAuthService,
  ) {}

  @Get('callback')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Redirect URL đăng ký với TikTok',
    description:
      'TikTok chuyển hướng trình duyệt Seller về đây kèm `code` và `state`. Backend xác thực ' +
      '`state`, tự đổi token, tự lấy shop, tự lưu kết nối rồi chuyển sang trang kết quả.',
  })
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    const query = req.query as Record<string, unknown>;

    // 🔴 Chỉ ghi TÊN tham số, không bao giờ ghi giá trị — `auth_code`/`state` là bí mật.
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'oauth.callback',
      receivedParams: Object.keys(query),
      msg: 'Nhận redirect uỷ quyền từ TikTok',
    });

    const outcome = await this.oauthService.handleCallback(
      {
        authorizationCode: this.readCode(query),
        state: this.readParam(query, TIKTOK_AUTHORIZE_STATE_PARAM),
        error: this.readParam(query, TIKTOK_CALLBACK_ERROR_PARAM),
      },
      { ipAddress: ip, userAgent },
    );

    // 302 sang trang kết quả. URL chỉ mang `ref` — một vé đọc tóm tắt phi nhạy cảm;
    // KHÔNG có auth_code, access_token hay refresh_token.
    res.redirect(
      this.buildRedirect(outcome.success ? LINK_SUCCESS_PATH : LINK_FAILED_PATH, {
        ref: outcome.resultToken,
        // Trường hợp state hỏng thì không có vé nào để tra — gửi thẳng mã lỗi để trang
        // thất bại vẫn nói được nguyên nhân.
        error: outcome.resultToken ? undefined : outcome.errorCode,
      }),
    );
  }

  @Get('link-result')
  @ApiOperation({
    summary: 'Tóm tắt kết quả một phiên uỷ quyền (trang kết quả công khai gọi)',
    description:
      'Trả tên shop, region, thời điểm liên kết hoặc mã lỗi. KHÔNG trả token dưới mọi hình thức. ' +
      'Công khai vì Seller có thể chưa đăng nhập; truy cập được chỉ khi giữ đúng vé `ref`.',
  })
  @ApiOkResponse({ type: PodTiktokLinkResultDto })
  linkResult(@Query() query: TiktokLinkResultQueryDto): Promise<PodTiktokLinkResultDto> {
    return this.oauthService.getLinkResult(query.ref);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Đọc authorization code: `code` theo tài liệu, chấp nhận `auth_code` như bí danh. */
  private readCode(query: Record<string, unknown>): string | undefined {
    for (const key of TIKTOK_CALLBACK_CODE_PARAMS) {
      const value = this.readParam(query, key);
      if (value) return value;
    }
    return undefined;
  }

  /** Query param lặp lại sẽ được Express trả về mảng — chỉ nhận giá trị chuỗi đơn. */
  private readParam(query: Record<string, unknown>, key: string): string | undefined {
    const value = query[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /**
   * Dựng URL trang kết quả. `callbackRedirectBase` trống ⇒ đường dẫn tương đối
   * (frontend và backend cùng domain qua Nginx — cấu hình triển khai hiện tại).
   */
  private buildRedirect(path: string, params: Record<string, string | undefined>): string {
    const base = (this.config.get<string>('tiktok.callbackRedirectBase') ?? '').replace(
      /\/+$/,
      '',
    );
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    const queryString = search.toString();
    return `${base}${path}${queryString ? `?${queryString}` : ''}`;
  }
}
