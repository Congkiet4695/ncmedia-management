import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Phân loại lỗi khi gọi nhà cung cấp fulfillment.
 * Quyết định DUY NHẤT việc có retry hay không — không rải điều kiện retry khắp code.
 */
export enum FulfillmentErrorClass {
  /** Sai/thiếu API key, không đủ quyền — lỗi cấu hình, KHÔNG retry. */
  AUTH = 'AUTH',
  /** Dữ liệu gửi lên không hợp lệ — KHÔNG retry cho tới khi sửa dữ liệu. */
  VALIDATION = 'VALIDATION',
  /** Không tìm thấy tài nguyên — KHÔNG retry. */
  NOT_FOUND = 'NOT_FOUND',
  /** Vượt giới hạn tần suất — CÓ retry (có backoff). */
  RATE_LIMIT = 'RATE_LIMIT',
  /** Lỗi mạng / timeout — CÓ retry. */
  NETWORK = 'NETWORK',
  /** Lỗi 5xx phía nhà cung cấp — CÓ retry. */
  SERVER = 'SERVER',
  /** Chưa phân loại được — KHÔNG retry để tránh lặp vô ích. */
  UNKNOWN = 'UNKNOWN',
}

/** Các lớp lỗi được phép thử lại. */
export const RETRYABLE_ERROR_CLASSES: readonly FulfillmentErrorClass[] = [
  FulfillmentErrorClass.RATE_LIMIT,
  FulfillmentErrorClass.NETWORK,
  FulfillmentErrorClass.SERVER,
];

/**
 * Lỗi THÔ từ tầng client — mang đủ ngữ cảnh kỹ thuật để ghi log và đối soát
 * (`requestId` là thứ bộ phận hỗ trợ của nhà cung cấp sẽ hỏi đầu tiên).
 * Service dịch sang exception nghiệp vụ trước khi trả ra API.
 */
export class FulfillmentClientError extends Error {
  constructor(
    readonly errorClass: FulfillmentErrorClass,
    readonly message: string,
    readonly httpStatus?: number,
    readonly providerCode?: string,
    readonly validationErrors?: Array<{ field?: string; message?: string; type?: string }>,
    readonly requestId?: string,
    readonly rawBody?: unknown,
    readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'FulfillmentClientError';
  }

  get retryable(): boolean {
    return RETRYABLE_ERROR_CLASSES.includes(this.errorClass);
  }
}

// ---------------------------------------------------------------------------
// Exception nghiệp vụ (trả ra API)
// ---------------------------------------------------------------------------

export class FulfillmentAccountNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'FULFILLMENT_ACCOUNT_NOT_FOUND',
      message:
        'Chưa cấu hình kết nối tới nhà cung cấp fulfillment. Vui lòng thêm tài khoản ở màn hình cấu hình.',
    });
  }
}

export class FulfillmentOrderNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'FULFILLMENT_ORDER_NOT_FOUND',
      message: 'Không tìm thấy bản ghi fulfillment cho đơn này',
    });
  }
}

/** Đơn đã được gửi rồi — chặn tạo trùng ở xưởng in (tốn tiền thật). */
export class FulfillmentAlreadySubmittedException extends ConflictException {
  constructor(status: string) {
    super({
      code: 'FULFILLMENT_ALREADY_SUBMITTED',
      message:
        `Đơn đã được gửi sang xưởng in (trạng thái hiện tại: ${status}). ` +
        'Dùng "Đồng bộ trạng thái" để cập nhật, hoặc huỷ trước khi gửi lại.',
    });
  }
}

/** Đơn chưa đủ điều kiện gửi — kèm danh sách lý do cụ thể để người dùng sửa. */
export class FulfillmentNotReadyException extends UnprocessableEntityException {
  constructor(reasons: Array<{ code: string; message: string }>) {
    super({
      code: 'FULFILLMENT_NOT_READY',
      message: 'Đơn chưa đủ điều kiện gửi sang xưởng in',
      errors: reasons.map((reason) => ({ field: reason.code, message: reason.message })),
    });
  }
}

/** Trạng thái hiện tại không cho phép huỷ (Mango chỉ huỷ được NEW_ORDER / ON_HOLD). */
export class FulfillmentCannotCancelException extends ConflictException {
  constructor(status: string) {
    super({
      code: 'FULFILLMENT_CANNOT_CANCEL',
      message:
        `Không thể huỷ ở trạng thái "${status}". ` +
        'Nhà cung cấp chỉ cho phép huỷ khi đơn còn ở trạng thái mới tiếp nhận hoặc tạm giữ.',
    });
  }
}

/** Nhà cung cấp từ chối dữ liệu — trả nguyên các lỗi field để người dùng sửa. */
export class FulfillmentValidationException extends BadRequestException {
  constructor(
    message: string,
    errors?: Array<{ field?: string; message?: string; type?: string }>,
  ) {
    super({
      code: 'FULFILLMENT_PROVIDER_VALIDATION',
      message,
      errors: (errors ?? []).map((error) => ({
        field: error.field ?? 'unknown',
        message: error.message ?? '',
      })),
    });
  }
}

export class FulfillmentProviderAuthException extends BadGatewayException {
  constructor() {
    super({
      code: 'FULFILLMENT_PROVIDER_AUTH',
      message:
        'API key của nhà cung cấp không hợp lệ hoặc không đủ quyền. Vui lòng kiểm tra cấu hình.',
    });
  }
}

export class FulfillmentProviderTimeoutException extends GatewayTimeoutException {
  constructor() {
    super({
      code: 'FULFILLMENT_PROVIDER_TIMEOUT',
      message: 'Nhà cung cấp fulfillment phản hồi quá chậm. Vui lòng thử lại.',
    });
  }
}

export class FulfillmentRateLimitedException extends HttpException {
  constructor() {
    super(
      {
        code: 'FULFILLMENT_RATE_LIMITED',
        message: 'Đang bị nhà cung cấp giới hạn tần suất. Vui lòng thử lại sau ít phút.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class FulfillmentProviderException extends BadGatewayException {
  constructor(message = 'Nhà cung cấp fulfillment trả về lỗi. Vui lòng thử lại sau.') {
    super({ code: 'FULFILLMENT_PROVIDER_ERROR', message });
  }
}

/** Ánh xạ sản phẩm bị trùng (một khoá TikTok trỏ tới hai SKU khác nhau). */
export class FulfillmentMappingConflictException extends ConflictException {
  constructor() {
    super({
      code: 'FULFILLMENT_MAPPING_CONFLICT',
      message: 'Đã tồn tại ánh xạ cho sản phẩm/biến thể này',
    });
  }
}

export class FulfillmentMappingNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'FULFILLMENT_MAPPING_NOT_FOUND',
      message: 'Không tìm thấy ánh xạ sản phẩm',
    });
  }
}
