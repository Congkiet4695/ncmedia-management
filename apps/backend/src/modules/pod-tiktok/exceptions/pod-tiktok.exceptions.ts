import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { TiktokErrorClass } from '../constants/tiktok-error-code.constants';

/**
 * Mã lỗi nghiệp vụ dùng ở luồng uỷ quyền OAuth.
 *
 * Tách thành hằng số vì luồng callback KHÔNG trả JSON lỗi (trình duyệt Seller đang
 * đứng ở đó) — nó lưu mã vào bản ghi `state` rồi chuyển hướng, nên mã phải dùng được
 * cả ở nơi ném exception lẫn nơi chỉ ghi nhận. Frontend dịch mã sang thông điệp.
 */
export const POD_TIKTOK_OAUTH_ERROR_CODES = {
  INVALID_STATE: 'POD_TIKTOK_INVALID_STATE',
  AUTH_DENIED: 'POD_TIKTOK_AUTH_DENIED',
  LINK_RESULT_NOT_FOUND: 'POD_TIKTOK_LINK_RESULT_NOT_FOUND',
  API_ERROR: 'POD_TIKTOK_API_ERROR',
} as const;

/** Không tìm thấy kết nối TikTok trong Organization. */
export class PodTiktokAccountNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'POD_TIKTOK_ACCOUNT_NOT_FOUND',
      message: 'Không tìm thấy kết nối TikTok Shop',
    });
  }
}

/**
 * Seller được phân công không đủ điều kiện: khác Organization, hồ sơ không ACTIVE,
 * hoặc Role không phải EMPLOYEE (Admin/Fulfillment không được làm seller).
 */
/** Nhà cung cấp fulfillment được chọn không dùng được (khác tổ chức, đã xoá hoặc INACTIVE). */
export class PodTiktokFulfillmentProviderInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_TIKTOK_FULFILLMENT_PROVIDER_INVALID',
      message:
        'Nhà cung cấp fulfillment không hợp lệ: khác tổ chức, đã bị xoá, hoặc đang INACTIVE.',
    });
  }
}

export class PodTiktokSellerInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_TIKTOK_SELLER_INVALID',
      message:
        'Seller không hợp lệ. Chỉ chọn được nhân viên đang hoạt động và có vai trò EMPLOYEE ' +
        'trong tổ chức này.',
    });
  }
}

/** Authorization Code không hợp lệ / đã dùng / hết hạn (TikTok 36004004). */
export class PodTiktokInvalidAuthCodeException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_TIKTOK_INVALID_AUTH_CODE',
      message:
        'Authorization Code không hợp lệ, đã được sử dụng hoặc đã hết hạn. ' +
        'Mã chỉ dùng được MỘT LẦN và hết hạn sau 30 phút — vui lòng lấy mã mới rồi thử lại.',
    });
  }
}

/**
 * `state` của callback không hợp lệ: không tồn tại, đã dùng, hoặc đã hết hạn.
 *
 * 🔴 Gộp chung ba nguyên nhân vào MỘT thông điệp là có chủ ý — trả lời chi tiết hơn
 * chỉ giúp người tấn công dò xem state nào từng tồn tại. Chi tiết nằm ở log.
 */
export class PodTiktokInvalidStateException extends BadRequestException {
  constructor() {
    super({
      code: POD_TIKTOK_OAUTH_ERROR_CODES.INVALID_STATE,
      message:
        'Phiên uỷ quyền không hợp lệ hoặc đã hết hạn. Vui lòng bấm "Liên kết TikTok Shop" ' +
        'trong hệ thống để bắt đầu lại.',
    });
  }
}

/** Seller bấm Từ chối ở màn hình uỷ quyền (`error=auth_denied`). */
export class PodTiktokAuthorizationDeniedException extends BadRequestException {
  constructor() {
    super({
      code: POD_TIKTOK_OAUTH_ERROR_CODES.AUTH_DENIED,
      message: 'Bạn đã từ chối cấp quyền cho ứng dụng trên TikTok Shop.',
    });
  }
}

/** Không tra được kết quả uỷ quyền (vé đã hết hạn hoặc sai). */
export class PodTiktokLinkResultNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: POD_TIKTOK_OAUTH_ERROR_CODES.LINK_RESULT_NOT_FOUND,
      message: 'Không tìm thấy kết quả uỷ quyền cho phiên này.',
    });
  }
}

/** Token thuộc loại người dùng không phải Seller (user_type ∉ {0,4,5}). */
export class PodTiktokInvalidUserTypeException extends BadRequestException {
  constructor(userType: number) {
    super({
      code: 'POD_TIKTOK_INVALID_USER_TYPE',
      message:
        `Mã uỷ quyền thuộc loại người dùng không hợp lệ (user_type=${userType}). ` +
        'Vui lòng dùng link uỷ quyền dành cho Seller (Seller authorization).',
    });
  }
}

/** Shop đã được link trong Organization này. */
export class PodTiktokShopAlreadyLinkedException extends ConflictException {
  constructor(shopName?: string) {
    super({
      code: 'POD_TIKTOK_SHOP_ALREADY_LINKED',
      message: shopName
        ? `TikTok Shop "${shopName}" đã được liên kết trong tổ chức này`
        : 'TikTok Shop này đã được liên kết trong tổ chức này',
    });
  }
}

/** Seller (open_id) đã được link trong Organization này. */
export class PodTiktokAccountAlreadyLinkedException extends ConflictException {
  constructor() {
    super({
      code: 'POD_TIKTOK_ACCOUNT_ALREADY_LINKED',
      message:
        'Tài khoản TikTok Seller này đã được liên kết trong tổ chức. ' +
        'Nếu muốn cấp quyền lại, hãy dùng chức năng uỷ quyền lại trên kết nối hiện có.',
    });
  }
}

/** Uỷ quyền thành công nhưng TikTok không trả về shop nào. */
export class PodTiktokNoShopException extends BadRequestException {
  constructor() {
    super({
      code: 'POD_TIKTOK_NO_SHOP',
      message:
        'Uỷ quyền thành công nhưng không tìm thấy TikTok Shop nào cho tài khoản này. ' +
        'Vui lòng kiểm tra tài khoản Seller đã có shop đang hoạt động.',
    });
  }
}

/** App thiếu access scope cần thiết (TikTok 105005). */
export class PodTiktokScopeMissingException extends ForbiddenException {
  constructor() {
    super({
      code: 'POD_TIKTOK_SCOPE_MISSING',
      message:
        'App chưa được cấp đủ quyền (access scope) để gọi API này. ' +
        'Vui lòng kiểm tra Partner Center → App & Service → Manage API.',
    });
  }
}

/** Không tìm thấy đơn TikTok trong Organization. */
export class PodOrderNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'POD_ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng TikTok' });
  }
}

/** Không tìm thấy sản phẩm (line item) trong Organization. */
export class PodOrderItemNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'POD_ORDER_ITEM_NOT_FOUND',
      message: 'Không tìm thấy sản phẩm trong đơn hàng',
    });
  }
}

/** Không có design tại vị trí in yêu cầu. */
export class PodDesignNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'POD_DESIGN_NOT_FOUND',
      message: 'Sản phẩm chưa có design tại vị trí này',
    });
  }
}

/** Đang có lượt đồng bộ chạy cho shop này. */
export class PodTiktokSyncInProgressException extends ConflictException {
  constructor() {
    super({
      code: 'POD_TIKTOK_SYNC_IN_PROGRESS',
      message: 'Đang có lượt đồng bộ chạy cho shop này. Vui lòng thử lại sau.',
    });
  }
}

/** Lỗi nghiệp vụ/hệ thống khi gọi TikTok API — không lộ message gốc ra người dùng. */
export class PodTiktokApiException extends BadGatewayException {
  constructor(message = 'TikTok API trả về lỗi. Vui lòng thử lại sau.') {
    super({ code: POD_TIKTOK_OAUTH_ERROR_CODES.API_ERROR, message });
  }
}

/** Hết thời gian chờ TikTok API. */
export class PodTiktokApiTimeoutException extends GatewayTimeoutException {
  constructor() {
    super({
      code: 'POD_TIKTOK_API_TIMEOUT',
      message: 'Hết thời gian chờ phản hồi từ TikTok. Vui lòng thử lại.',
    });
  }
}

/** Bị TikTok giới hạn tần suất (HTTP 429 / 36009002). */
export class PodTiktokRateLimitedException extends HttpException {
  constructor() {
    super(
      {
        code: 'POD_TIKTOK_RATE_LIMITED',
        message: 'TikTok đang giới hạn tần suất gọi API. Vui lòng thử lại sau ít phút.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Lỗi thô từ tầng client TikTok — mang đầy đủ ngữ cảnh kỹ thuật để LOG
 * (đặc biệt `requestId`, thứ TikTok Support yêu cầu khi mở ticket).
 * Service sẽ dịch sang exception nghiệp vụ ở trên trước khi trả ra API.
 */
export class TiktokClientError extends Error {
  /** Giá trị header `Retry-After` (giây) nếu TikTok có trả về — dùng cho backoff. */
  retryAfterSeconds?: number;

  constructor(
    readonly errorClass: TiktokErrorClass,
    readonly tiktokCode: number,
    readonly tiktokMessage: string,
    readonly httpStatus: number,
    readonly requestId?: string,
    readonly endpoint?: string,
  ) {
    super(`TikTok API error ${tiktokCode}: ${tiktokMessage}`);
    this.name = 'TiktokClientError';
  }
}
