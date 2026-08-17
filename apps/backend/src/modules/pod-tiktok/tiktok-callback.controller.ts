import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  TIKTOK_CALLBACK_CODE_PARAMS,
  TIKTOK_CALLBACK_ERROR_PARAM,
  TIKTOK_AUTHORIZE_STATE_PARAM,
} from './constants/tiktok.constants';
import { CompleteTiktokOAuthDto, TiktokLinkResultQueryDto } from './dto/tiktok-oauth.dto';
import {
  PodTiktokLinkResultDto,
  PodTiktokOAuthCompleteDto,
} from './dto/pod-tiktok-response.dto';
import { PodTiktokOAuthService } from './services/pod-tiktok-oauth.service';

/** Trang kết quả (công khai) — Seller có thể chưa đăng nhập hệ thống khi tới đây. */
const LINK_SUCCESS_PATH = '/tiktok/link-success';
const LINK_FAILED_PATH = '/tiktok/link-failed';

/**
 * TiktokCallbackController — xử lý phần sau khi Seller bấm Approve trên TikTok.
 *
 * ⚠️ **Công khai có chủ ý**: không `@UseGuards` — Seller quay về từ TikTok khi CHƯA đăng nhập
 * hệ thống. Đặt guard vào là họ lạc sang màn hình login và phiên uỷ quyền hỏng.
 *
 * 🔴 Danh tính KHÔNG lấy từ request (không cookie, không JWT) mà từ bản ghi `state` đã được
 * xác thực — đó là lý do `state` bắt buộc phải có, phải ngẫu nhiên và chỉ dùng một lần.
 *
 * Hai đường vào, MỘT nghiệp vụ:
 *
 * 1. `POST /tiktok/oauth/complete` — **đường chính**. Redirect URI đăng ký với TikTok trỏ
 *    thẳng vào trang frontend `/tiktok/link-success`; trang đó vừa mở là gọi xuống đây kèm
 *    `code` + `state`, nhận về tóm tắt rồi xoá sạch query khỏi thanh địa chỉ.
 * 2. `GET /tiktok/callback` — **tương thích ngược** cho môi trường vẫn đăng ký Redirect URI
 *    trỏ vào backend: xử lý y hệt rồi 302 sang trang kết quả kèm vé `ref`.
 *
 * Cả hai đều gọi `PodTiktokOAuthService.handleCallback` ⇒ không có bản sao nghiệp vụ nào.
 * Người dùng KHÔNG copy/dán Authorization Code ở bất kỳ đường nào (yêu cầu App Review).
 */
@ApiTags('POD — TikTok Callback')
@Controller('tiktok')
export class TiktokCallbackController {
  private readonly logger = new Logger(TiktokCallbackController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly oauthService: PodTiktokOAuthService,
  ) {}

  /**
   * Hoàn tất uỷ quyền cho trang kết quả (đường chính).
   *
   * 🔴 Công khai: Seller vừa từ TikTok quay về, chưa chắc đã đăng nhập hệ thống. Không có
   * rủi ro lạm dụng vì muốn gọi được phải nắm `state` — 256 bit ngẫu nhiên, một lần, có hạn;
   * sai `state` là dừng ngay, KHÔNG có lệnh gọi nào sang TikTok.
   *
   * Luôn trả HTTP 200 kèm `success`: đây là dữ liệu để dựng màn hình kết quả, không phải
   * lỗi giao vận. Lỗi nghiệp vụ nằm ở `errorCode` + `message`.
   */
  @Post('oauth/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hoàn tất uỷ quyền TikTok từ trang kết quả',
    description:
      'Nhận `code` + `state` mà TikTok trả về trang `/tiktok/link-success`, rồi thực hiện ' +
      'TOÀN BỘ phần OAuth ở backend: xác thực state → đổi token → Get Authorized Shops → ' +
      'lưu/cập nhật kết nối với Account Name đã nhập → đánh dấu state USED. ' +
      'Frontend KHÔNG xử lý OAuth và KHÔNG bao giờ hiển thị/lưu `code`.',
  })
  @ApiOkResponse({ type: PodTiktokOAuthCompleteDto })
  async completeOAuth(
    @Body() dto: CompleteTiktokOAuthDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PodTiktokOAuthCompleteDto> {
    // Tham số nhận diện app/thị trường — an toàn để log và hữu ích khi đối soát với TikTok.
    // 🔴 `code`/`state` thì KHÔNG bao giờ được log.
    this.logger.log({
      module: 'pod-tiktok',
      operation: 'oauth.complete',
      locale: dto.locale ?? null,
      shopRegion: dto.shopRegion ?? null,
      msg: 'Trang kết quả yêu cầu hoàn tất uỷ quyền',
    });
    this.warnOnAppKeyMismatch(dto.appKey);

    const outcome = await this.oauthService.handleCallback(
      { authorizationCode: dto.code, state: dto.state },
      { ipAddress: ip, userAgent },
    );

    return {
      success: outcome.success,
      accountName: outcome.accountName ?? null,
      shopName: outcome.shopName ?? null,
      region: outcome.region ?? null,
      shopCount: outcome.shopCount ?? 0,
      linkedAt: outcome.linkedAt ?? null,
      errorCode: outcome.errorCode ?? null,
      message: outcome.message ?? null,
    };
  }

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

  /**
   * `app_key` lệch với cấu hình = đang dùng nhầm app (vd link uỷ quyền của môi trường khác).
   * Chỉ CẢNH BÁO chứ không chặn: `state` mới là cơ chế xác thực, và chặn ở đây sẽ biến một
   * sai lệch cấu hình nhỏ thành "không link được" mà không ai hiểu vì sao.
   */
  private warnOnAppKeyMismatch(appKey?: string): void {
    const configured = this.config.get<string>('tiktok.appKey');
    if (appKey && configured && appKey !== configured) {
      this.logger.warn({
        module: 'pod-tiktok',
        operation: 'oauth.complete',
        msg: 'app_key trong callback KHÁC app_key đang cấu hình — kiểm tra lại Partner Center',
      });
    }
  }

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
